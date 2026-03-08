package session

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
	params, runtime, err := s.normalizeAndCreateRuntime(request, sessionType)
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
	s.recordRecentSession(request, sessionType, params)

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
	records, err := s.recentStore.ListByTool(toolID)
	if err != nil {
		return nil, err
	}

	if strings.EqualFold(normalizeToolID(toolID), "ssh") {
		credentialIDs, err := s.sshManager.ListCredentialIDs()
		if err == nil {
			allowed := make(map[string]struct{}, len(credentialIDs))
			for _, credentialID := range credentialIDs {
				allowed[credentialID] = struct{}{}
			}
			filtered := make([]RecentSessionRecord, 0, len(records))
			for _, record := range records {
				if record.Request.SSH == nil || strings.TrimSpace(record.Request.SSH.CredentialID) == "" {
					continue
				}
				if _, ok := allowed[strings.TrimSpace(record.Request.SSH.CredentialID)]; !ok {
					continue
				}
				filtered = append(filtered, record)
			}
			if len(filtered) != len(records) {
				_ = s.recentStore.ReplaceToolRecords(toolID, filtered)
			}
			records = filtered
		}
	}

	result := make([]model.RecentSessionItemResponse, 0, len(records))
	for _, item := range records {
		result = append(result, model.RecentSessionItemResponse{
			ToolID:      item.ToolID,
			Title:       item.Title,
			SessionType: item.SessionType,
			Workdir:     item.Workdir,
			LastUsedAt:  item.LastUsedAt,
			Request:     item.Request,
		})
	}
	return result, nil
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

func (s *Service) normalizeAndCreateRuntime(request model.CreateSessionRequest, sessionType model.SessionType) (createParams, termruntime.Runtime, error) {
	cols := 120
	rows := 30
	if request.Cols != nil {
		cols = *request.Cols
	}
	if request.Rows != nil {
		rows = *request.Rows
	}
	if cols <= 0 || rows <= 0 || cols > s.cfg.Terminal.MaxCols || rows > s.cfg.Terminal.MaxRows {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "terminal size is invalid", nil)
	}

	if sessionType == model.SessionTypeSSHShell {
		title := fallbackString(request.TabTitle, "ssh")
		toolID := fallbackString(request.ToolID, "ssh")
		runtime, rootPath, resolved, err := s.sshManager.OpenShell(request.SSH, request.Workdir, cols, rows)
		if err != nil {
			return createParams{}, nil, err
		}
		workdir := rootPath
		if strings.TrimSpace(request.Workdir) != "" {
			workdir = strings.TrimSpace(request.Workdir)
		}
		return createParams{
			Workdir:      workdir,
			Cols:         cols,
			Rows:         rows,
			Title:        title,
			ToolID:       toolID,
			FileRootPath: rootPath,
			ResolvedSSH:  &resolved,
		}, runtime, nil
	}

	if strings.TrimSpace(request.ClientID) != "" {
		return s.normalizeCLISession(request, cols, rows)
	}

	command := fallbackString(request.Command, s.cfg.Terminal.DefaultCommand)
	if command == "" {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "command must not be blank", nil)
	}
	args := request.Args
	if args == nil {
		args = append([]string(nil), s.cfg.Terminal.DefaultArgs...)
	}
	workdir := fallbackString(request.Workdir, s.cfg.Terminal.DefaultWorkdir)
	if err := validateLocalWorkdir(workdir); err != nil {
		return createParams{}, nil, err
	}
	env := currentEnvMap()
	for key, value := range request.Env {
		env[key] = value
	}
	if _, ok := env["TERM"]; !ok {
		env["TERM"] = "xterm-256color"
	}

	fullCommand := append([]string{command}, args...)
	runtime, err := termruntime.StartLocal(fullCommand, env, workdir, cols, rows)
	if err != nil {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "Failed to start terminal runtime", err)
	}
	return createParams{
		Command:      fullCommand,
		Env:          env,
		Workdir:      workdir,
		Cols:         cols,
		Rows:         rows,
		Title:        fallbackString(request.TabTitle, command),
		ToolID:       fallbackString(request.ToolID, "terminal"),
		FileRootPath: absWorkdir(workdir),
	}, runtime, nil
}

func (s *Service) normalizeCLISession(request model.CreateSessionRequest, cols, rows int) (createParams, termruntime.Runtime, error) {
	clientID := strings.TrimSpace(request.ClientID)
	var client *config.CLIClientConfig
	for idx := range s.cfg.Terminal.CliClients {
		item := &s.cfg.Terminal.CliClients[idx]
		if strings.TrimSpace(item.ID) == clientID {
			client = item
			break
		}
	}
	if client == nil {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "Unknown cli client: "+clientID, nil)
	}
	command := strings.TrimSpace(client.Command)
	if command == "" {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "cli client command must not be blank: "+clientID, nil)
	}
	workdir := request.Workdir
	if strings.TrimSpace(workdir) == "" {
		workdir = fallbackString(client.Workdir, s.cfg.Terminal.DefaultWorkdir)
	}
	if err := validateLocalWorkdir(workdir); err != nil {
		return createParams{}, nil, err
	}
	env := currentEnvMap()
	for key, value := range client.Env {
		env[key] = value
	}
	for key, value := range request.Env {
		env[key] = value
	}
	if _, ok := env["TERM"]; !ok {
		env["TERM"] = "xterm-256color"
	}

	fullCommand := append([]string{command}, client.Args...)
	if preCommands := trimNonEmpty(client.PreCommands); len(preCommands) > 0 {
		shell := fallbackString(client.Shell, "/bin/zsh")
		script := strings.Join(preCommands, "; ") + "; exec " + shellJoin(fullCommand)
		fullCommand = []string{shell, "-lc", script}
	}
	runtime, err := termruntime.StartLocal(fullCommand, env, workdir, cols, rows)
	if err != nil {
		return createParams{}, nil, util.NewStatusError(http.StatusBadRequest, "Failed to start terminal runtime", err)
	}
	defaultTitle := fallbackString(client.Label, clientID)
	return createParams{
		Command:      fullCommand,
		Env:          env,
		Workdir:      workdir,
		Cols:         cols,
		Rows:         rows,
		Title:        fallbackString(request.TabTitle, defaultTitle),
		ToolID:       fallbackString(request.ToolID, clientID),
		FileRootPath: absWorkdir(workdir),
	}, runtime, nil
}

func (s *Service) startReadLoop(session *Session) {
	go func() {
		buffer := make([]byte, 8192)
		for {
			read, err := session.Runtime.Reader().Read(buffer)
			if read > 0 {
				output := append([]byte(nil), buffer[:read]...)
				seq := session.NextSeq.Add(1)
				session.RingBuffer.Append(seq, output)
				text := string(output)
				session.ScreenTracker.OnOutput(seq, text)
				session.ContextTracker.OnOutput(seq, text)
				s.broadcastPayload(session, map[string]any{
					"type": "output",
					"seq":  seq,
					"data": text,
				})
			}
			if err == nil {
				continue
			}
			if err == io.EOF {
				exitCode, waitErr := session.Runtime.Wait()
				if waitErr != nil && exitCode < 0 {
					session.ContextTracker.OnError("Terminal stream error")
					s.broadcastPayload(session, map[string]any{
						"type":    "error",
						"message": "Terminal stream error",
					})
					s.removeAndClose(session.SessionID, "stream read error", true, nil)
					return
				}
				s.removeAndClose(session.SessionID, "runtime exited", true, &exitCode)
				return
			}
			if !session.Closed.Load() {
				session.ContextTracker.OnError("Terminal stream error")
				s.broadcastPayload(session, map[string]any{
					"type":    "error",
					"message": "Terminal stream error",
				})
				s.removeAndClose(session.SessionID, "stream read error", true, nil)
			}
			return
		}
	}()
}

func (s *Service) replayBufferedOutput(session *Session, conn *websocket.Conn, lastSeenSeq int64) {
	session.SendMu.Lock()
	defer session.SendMu.Unlock()

	snapshot := session.RingBuffer.SnapshotAfter(lastSeenSeq)
	if snapshot.Truncated {
		session.ContextTracker.OnTruncated()
		_ = conn.WriteJSON(map[string]any{
			"type":              "truncated",
			"requestedAfterSeq": lastSeenSeq,
			"firstAvailableSeq": snapshot.FirstAvailableSeq,
			"latestSeq":         snapshot.LatestSeq,
		})
	}
	for _, chunk := range snapshot.Chunks {
		_ = conn.WriteJSON(map[string]any{
			"type": "output",
			"seq":  chunk.Seq,
			"data": string(chunk.Data),
		})
	}
}

func (s *Service) broadcastPayload(session *Session, payload map[string]any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}

	session.SendMu.Lock()
	defer session.SendMu.Unlock()

	session.ClientsMu.Lock()
	defer session.ClientsMu.Unlock()
	for clientID, conn := range session.Clients {
		if conn == nil {
			delete(session.Clients, clientID)
			continue
		}
		if err := conn.WriteMessage(websocket.TextMessage, raw); err != nil {
			delete(session.Clients, clientID)
			_ = conn.Close()
		}
	}
}

func (s *Service) writeInputInternal(sessionID, data, source string) error {
	session, err := s.GetRequiredSession(sessionID)
	if err != nil {
		return err
	}
	if data == "" {
		return nil
	}
	session.ContextTracker.OnInput(data, source)
	if _, err := session.Runtime.Write([]byte(data)); err != nil {
		session.ContextTracker.OnError("Failed writing to terminal process")
		s.broadcastPayload(session, map[string]any{
			"type":    "error",
			"message": "Failed writing to terminal process",
		})
		s.removeAndClose(sessionID, "write error", true, nil)
		return util.NewStatusError(http.StatusBadRequest, "Failed writing to terminal process", err)
	}
	return nil
}

func (s *Service) removeAndClose(sessionID, reason string, sendExit bool, exitCodeOverride *int) {
	s.mu.Lock()
	session, ok := s.sessions[sessionID]
	if ok {
		delete(s.sessions, sessionID)
	}
	s.mu.Unlock()
	if ok {
		s.closeInternal(session, reason, sendExit, exitCodeOverride)
	}
}

func (s *Service) closeInternal(session *Session, reason string, sendExit bool, exitCodeOverride *int) {
	if !session.Closed.CompareAndSwap(false, true) {
		return
	}
	session.ClientsMu.Lock()
	if session.KillTimer != nil {
		session.KillTimer.Stop()
		session.KillTimer = nil
	}
	session.ClientsMu.Unlock()

	exitCode := exitCodeOverride
	if sendExit && exitCode == nil {
		exitCode = session.Runtime.ExitCode()
	}
	if sendExit {
		exitValue := -1
		if exitCode != nil {
			exitValue = *exitCode
		}
		s.broadcastPayload(session, map[string]any{
			"type":     "exit",
			"exitCode": exitValue,
		})
	}

	session.ContextTracker.OnSessionClosed(exitCode)
	_ = session.Runtime.Close()

	session.ClientsMu.Lock()
	for key, conn := range session.Clients {
		if conn != nil {
			_ = conn.Close()
		}
		delete(session.Clients, key)
	}
	session.ClientsMu.Unlock()
	_ = reason
}

func (s *Service) recordRecentSession(request model.CreateSessionRequest, sessionType model.SessionType, params createParams) {
	recentRequest := request
	recentRequest.SessionType = sessionType
	recentRequest.ToolID = fallbackString(request.ToolID, params.ToolID)
	recentRequest.TabTitle = fallbackString(request.TabTitle, params.Title)
	recentRequest.Workdir = params.Workdir
	if sessionType == model.SessionTypeSSHShell && params.ResolvedSSH != nil {
		if recentRequest.SSH == nil {
			recentRequest.SSH = &model.SshSessionRequest{}
		}
		recentRequest.SSH.CredentialID = params.ResolvedSSH.CredentialID
		if recentRequest.SSH.Term == "" {
			recentRequest.SSH.Term = params.ResolvedSSH.Term
		}
	}
	if err := s.recentStore.Record(recentRequest.ToolID, recentRequest.TabTitle, sessionType, recentRequest.Workdir, recentRequest); err != nil {
		return
	}
}

func validateLocalWorkdir(workdir string) error {
	info, err := os.Stat(workdir)
	if err != nil {
		return util.NewStatusError(http.StatusBadRequest, "workdir must be an existing directory", err)
	}
	if !info.IsDir() {
		return util.NewStatusError(http.StatusBadRequest, "workdir must be an existing directory", err)
	}
	return nil
}

func absWorkdir(workdir string) string {
	absolute, err := filepath.Abs(workdir)
	if err != nil {
		return workdir
	}
	return filepath.Clean(absolute)
}

func fallbackString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func currentEnvMap() map[string]string {
	result := map[string]string{}
	for _, entry := range os.Environ() {
		idx := strings.Index(entry, "=")
		if idx <= 0 {
			continue
		}
		result[entry[:idx]] = entry[idx+1:]
	}
	return result
}

func trimNonEmpty(items []string) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			continue
		}
		result = append(result, strings.TrimSpace(item))
	}
	return result
}

func shellJoin(command []string) string {
	parts := make([]string, 0, len(command))
	for _, item := range command {
		parts = append(parts, "'"+strings.ReplaceAll(item, "'", "'\"'\"'")+"'")
	}
	return strings.Join(parts, " ")
}

func normalizeToolID(toolID string) string {
	if strings.TrimSpace(toolID) == "" {
		return "terminal"
	}
	return strings.TrimSpace(toolID)
}
