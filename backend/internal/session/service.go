package session

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	sshsvc "term-webclient-go/backend/internal/ssh"
	"term-webclient-go/backend/internal/termruntime"
	"term-webclient-go/backend/internal/util"
)

var ansiEscapePattern = regexp.MustCompile(`\x1B\[[;?0-9]*[ -/]*[@-~]`)

type Service struct {
	cfg         *config.Config
	sshManager  *sshsvc.Manager
	recentStore *RecentStore

	mu       sync.RWMutex
	sessions map[string]*Session
}

type Session struct {
	SessionID       string
	Title           string
	ToolID          string
	SessionType     model.SessionType
	Workdir         string
	FileRootPath    string
	SSHCredentialID string
	StartedAt       time.Time

	Runtime        termruntime.Runtime
	RingBuffer     *RingBuffer
	ContextTracker *ContextTracker
	ScreenTracker  *ScreenTextTracker

	Clients   map[string]*websocket.Conn
	ClientsMu sync.Mutex
	SendMu    sync.Mutex
	NextSeq   atomic.Int64
	Closed    atomic.Bool
	KillTimer *time.Timer
}

type createParams struct {
	Command      []string
	Env          map[string]string
	Workdir      string
	Cols         int
	Rows         int
	Title        string
	ToolID       string
	FileRootPath string
	ResolvedSSH  *sshsvc.ResolvedCredential
}

func NewService(cfg *config.Config, sshManager *sshsvc.Manager) *Service {
	return &Service{
		cfg:         cfg,
		sshManager:  sshManager,
		recentStore: NewRecentStore(cfg.Terminal),
		sessions:    map[string]*Session{},
	}
}

func (s *Service) CreateSession(request model.CreateSessionRequest) (model.CreateSessionResponse, error) {
	sessionType := model.NormalizeSessionType(request.SessionType)
	sessionID := util.NewID()
	params, runtime, err := NewRuntimeFactory(s.cfg, s.sshManager).CreateRuntime(request, sessionType)
	if err != nil {
		return model.CreateSessionResponse{}, err
	}

	session := &Session{
		SessionID:      sessionID,
		Title:          params.Title,
		ToolID:         params.ToolID,
		SessionType:    sessionType,
		Workdir:        params.Workdir,
		FileRootPath:   params.FileRootPath,
		StartedAt:      time.Now().UTC(),
		Runtime:        runtime,
		RingBuffer:     NewRingBuffer(s.cfg.Terminal.RingBufferMaxBytes, s.cfg.Terminal.RingBufferMaxChunks),
		ContextTracker: NewContextTracker(sessionID, sessionType, s.cfg.Terminal.SessionEventMaxEntries, s.cfg.Terminal.CommandFrameMaxEntries, params.Workdir),
		ScreenTracker:  NewScreenTextTracker(params.Cols, params.Rows),
		Clients:        map[string]*websocket.Conn{},
	}
	if params.ResolvedSSH != nil {
		session.SSHCredentialID = params.ResolvedSSH.CredentialID
	}

	s.mu.Lock()
	s.sessions[sessionID] = session
	s.mu.Unlock()

	s.startReadLoop(session)
	_ = s.recentStore.RecordCreateRequest(request, sessionType, params)

	return model.CreateSessionResponse{
		SessionID: sessionID,
		WSURL:     "/ws/" + sessionID,
		StartedAt: session.StartedAt,
	}, nil
}

func (s *Service) Exists(sessionID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.sessions[sessionID]
	return ok
}

func (s *Service) ListSessions() []model.SessionTabViewResponse {
	s.mu.RLock()
	sessions := make([]*Session, 0, len(s.sessions))
	for _, session := range s.sessions {
		sessions = append(sessions, session)
	}
	s.mu.RUnlock()

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.Before(sessions[j].StartedAt)
	})

	result := make([]model.SessionTabViewResponse, 0, len(sessions))
	for _, session := range sessions {
		context := session.ContextTracker.Snapshot(1, 1)
		result = append(result, model.SessionTabViewResponse{
			SessionID:       session.SessionID,
			WSURL:           "/ws/" + session.SessionID,
			Title:           session.Title,
			ToolID:          session.ToolID,
			SessionType:     session.SessionType,
			Workdir:         session.Workdir,
			FileRootPath:    session.FileRootPath,
			StartedAt:       session.StartedAt,
			ConnectionState: context.Meta.ConnectionState,
		})
	}
	return result
}

func (s *Service) ListRecentSessions(toolID string) ([]model.RecentSessionItemResponse, error) {
	return s.recentStore.ListResponsesByTool(toolID, s.sshManager.ListCredentialIDs)
}

func (s *Service) GetSnapshot(sessionID string, afterSeq int64) (model.SessionSnapshotResponse, error) {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return model.SessionSnapshotResponse{}, err
	}
	snapshot := session.RingBuffer.SnapshotAfter(afterSeq)
	chunks := make([]model.TerminalOutputChunk, 0, len(snapshot.Chunks))
	for _, chunk := range snapshot.Chunks {
		chunks = append(chunks, model.TerminalOutputChunk{
			Seq:  chunk.Seq,
			Data: string(chunk.Data),
		})
	}

	fromSeq := snapshot.FirstAvailableSeq
	toSeq := snapshot.LatestSeq
	if len(chunks) > 0 {
		fromSeq = chunks[0].Seq
		toSeq = chunks[len(chunks)-1].Seq
	}
	return model.SessionSnapshotResponse{
		SessionID: sessionID,
		FromSeq:   fromSeq,
		ToSeq:     toSeq,
		Chunks:    chunks,
		Truncated: snapshot.Truncated,
	}, nil
}

func (s *Service) GetTranscript(sessionID string, afterSeq int64, stripAnsi bool) (model.TranscriptResponse, error) {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return model.TranscriptResponse{}, err
	}
	snapshot := session.RingBuffer.SnapshotAfter(afterSeq)
	var builder strings.Builder
	for _, chunk := range snapshot.Chunks {
		builder.Write(chunk.Data)
	}
	text := builder.String()
	if stripAnsi {
		text = ansiEscapePattern.ReplaceAllString(text, "")
	}
	truncated := snapshot.Truncated
	if len(text) > s.cfg.Terminal.TranscriptMaxChars {
		text = text[len(text)-s.cfg.Terminal.TranscriptMaxChars:]
		truncated = true
	}

	fromSeq := snapshot.FirstAvailableSeq
	toSeq := snapshot.LatestSeq
	if len(snapshot.Chunks) > 0 {
		fromSeq = snapshot.Chunks[0].Seq
		toSeq = snapshot.Chunks[len(snapshot.Chunks)-1].Seq
	}
	return model.TranscriptResponse{
		SessionID:      sessionID,
		FromSeq:        fromSeq,
		ToSeq:          toSeq,
		ChunkCount:     len(snapshot.Chunks),
		Truncated:      truncated,
		StripAnsi:      stripAnsi,
		TranscriptText: text,
	}, nil
}

func (s *Service) GetScreenText(sessionID string) (model.ScreenTextResponse, error) {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return model.ScreenTextResponse{}, err
	}
	screen := session.ScreenTracker.Snapshot()
	return model.ScreenTextResponse{
		SessionID: sessionID,
		LastSeq:   screen.LastSeq,
		Cols:      screen.Cols,
		Rows:      screen.Rows,
		Text:      screen.Text,
	}, nil
}

func (s *Service) GetContext(sessionID string, commandLimit, eventLimit int) (model.SessionContextResponse, error) {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return model.SessionContextResponse{}, err
	}
	return session.ContextTracker.Snapshot(commandLimit, eventLimit), nil
}

func (s *Service) AttachWebSocket(sessionID, clientID string, conn *websocket.Conn, lastSeenSeq int64) error {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(clientID) == "" {
		clientID = conn.RemoteAddr().String()
	}

	session.ClientsMu.Lock()
	if session.KillTimer != nil {
		session.KillTimer.Stop()
		session.KillTimer = nil
	}
	if previous := session.Clients[clientID]; previous != nil && previous != conn {
		_ = previous.Close()
	}
	session.Clients[clientID] = conn
	clientCount := len(session.Clients)
	session.ClientsMu.Unlock()

	session.ContextTracker.OnAttachedClientsChanged(clientCount)
	s.replayBufferedOutput(session, conn, lastSeenSeq)
	return nil
}

func (s *Service) DetachWebSocket(sessionID, clientID string, conn *websocket.Conn) {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return
	}

	session.ClientsMu.Lock()
	if clientID != "" {
		if existing := session.Clients[clientID]; existing == conn {
			delete(session.Clients, clientID)
		}
	} else {
		for key, existing := range session.Clients {
			if existing == conn {
				delete(session.Clients, key)
			}
		}
	}
	clientCount := len(session.Clients)
	if clientCount == 0 && !session.Closed.Load() {
		session.KillTimer = time.AfterFunc(time.Duration(s.cfg.Terminal.DetachedSessionTTL)*time.Second, func() {
			s.CloseSession(session.SessionID, "detached ttl exceeded", true)
		})
	}
	session.ClientsMu.Unlock()

	session.ContextTracker.OnAttachedClientsChanged(clientCount)
}

func (s *Service) WriteInput(sessionID, data string) error {
	return s.writeInputInternal(sessionID, data, "manual")
}

func (s *Service) WriteInputFromAgent(sessionID, data string) error {
	return s.writeInputInternal(sessionID, data, "agent")
}

func (s *Service) RegisterManagedCommand(sessionID, commandID, command string) error {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return err
	}
	session.ContextTracker.RegisterManagedCommand(commandID, command)
	return nil
}

func (s *Service) Resize(sessionID string, cols, rows int) error {
	if cols <= 0 || rows <= 0 || cols > s.cfg.Terminal.MaxCols || rows > s.cfg.Terminal.MaxRows {
		return util.NewStatusError(http.StatusBadRequest, "terminal size is invalid", nil)
	}
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return err
	}
	if err := session.Runtime.Resize(cols, rows); err != nil {
		return util.NewStatusError(http.StatusBadRequest, "Failed to resize session", err)
	}
	session.ContextTracker.OnResize(cols, rows)
	session.ScreenTracker.OnResize(cols, rows)
	return nil
}

func (s *Service) CloseSession(sessionID, reason string, sendExit bool) error {
	s.mu.Lock()
	session, ok := s.sessions[sessionID]
	if ok {
		delete(s.sessions, sessionID)
	}
	s.mu.Unlock()
	if !ok {
		return util.NewStatusError(http.StatusNotFound, "session not found", nil)
	}
	s.closeInternal(session, reason, sendExit, nil)
	return nil
}

func (s *Service) GetRequiredSession(sessionID string) (*Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.sessions[sessionID]
	if !ok {
		return nil, util.NewStatusError(http.StatusNotFound, "session not found", nil)
	}
	return session, nil
}

func (s *Service) Close() error {
	s.mu.Lock()
	sessions := make([]*Session, 0, len(s.sessions))
	for _, session := range s.sessions {
		sessions = append(sessions, session)
	}
	s.sessions = map[string]*Session{}
	s.mu.Unlock()
	for _, session := range sessions {
		s.closeInternal(session, "server shutdown", false, nil)
	}
	return nil
}
