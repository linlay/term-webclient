package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"term-webclient-go/backend/internal/agent"
	"term-webclient-go/backend/internal/assist"
	"term-webclient-go/backend/internal/auth"
	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/files"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/session"
	sshsvc "term-webclient-go/backend/internal/ssh"
	"term-webclient-go/backend/internal/util"
	"term-webclient-go/backend/internal/workdir"
	"term-webclient-go/backend/internal/workspace"
)

type App struct {
	cfg       *config.Config
	auth      *auth.Service
	ssh       *sshsvc.Manager
	sessions  *session.Service
	files     *files.Service
	workspace *workspace.Service
	workdir   *workdir.Service
	agent     *agent.Service
	assist    *assist.Service
	mux       *http.ServeMux
	upgrader  websocket.Upgrader
}

func New(cfg *config.Config) (*App, error) {
	authService := auth.New(cfg)
	sshManager := sshsvc.NewManager(cfg.Terminal.SSH)
	sessionService := session.NewService(cfg, sshManager)
	workspaceService := workspace.New(cfg)
	workdirService, err := workdir.New(cfg)
	if err != nil {
		return nil, err
	}
	fileService := files.New(cfg, sessionService, sshManager)
	agentService := agent.New(cfg, sessionService, workspaceService)
	assistService := assist.New(cfg, sessionService)

	app := &App{
		cfg:       cfg,
		auth:      authService,
		ssh:       sshManager,
		sessions:  sessionService,
		files:     fileService,
		workspace: workspaceService,
		workdir:   workdirService,
		agent:     agentService,
		assist:    assistService,
		mux:       http.NewServeMux(),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
	app.routes()
	return app, nil
}

func (a *App) routes() {
	a.mux.HandleFunc("/ws/", a.handleWS)
	a.mux.HandleFunc("/webapi/", a.handleWebAPI)
	a.mux.HandleFunc("/appapi/", a.handleAppAPI)
	a.mux.HandleFunc("/webapi", a.handleWebAPI)
	a.mux.HandleFunc("/appapi", a.handleAppAPI)
}

func (a *App) Handler() http.Handler {
	return a.mux
}

func (a *App) Close() error {
	return a.sessions.Close()
}

func (a *App) handleWebAPI(w http.ResponseWriter, r *http.Request) {
	a.handleAPI(w, r, "/webapi", false)
}

func (a *App) handleAppAPI(w http.ResponseWriter, r *http.Request) {
	a.handleAPI(w, r, "/appapi", true)
}

func (a *App) handleAPI(w http.ResponseWriter, r *http.Request, prefix string, appMode bool) {
	a.applyCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, prefix)
	segments := splitPath(path)
	if len(segments) == 0 {
		http.NotFound(w, r)
		return
	}
	if !(len(segments) == 1 && segments[0] == "version") {
		if appMode {
			if !(len(segments) == 2 && segments[0] == "auth" && segments[1] == "me") && !isTicketDownloadRequest(r) {
				if _, err := a.auth.RequireApp(r); err != nil {
					writeError(w, err)
					return
				}
			}
		} else {
			if !(len(segments) >= 1 && segments[0] == "auth") && !isTicketDownloadRequest(r) {
				if _, err := a.auth.RequireWeb(r); err != nil {
					writeError(w, err)
					return
				}
			}
		}
	}

	switch segments[0] {
	case "version":
		a.handleVersion(w, r)
	case "auth":
		a.handleAuth(w, r, appMode, segments[1:])
	case "sessions":
		a.handleSessions(w, r, appMode, segments[1:])
	case "ssh":
		a.handleSSH(w, r, segments[1:])
	case "terminal":
		a.handleTerminal(w, r, segments[1:])
	case "workdirTree":
		a.handleWorkdir(w, r)
	case "workspace":
		a.handleWorkspace(w, r, segments[1:])
	default:
		http.NotFound(w, r)
	}
}

func (a *App) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}
	writeJSON(w, http.StatusOK, model.SystemVersionResponse{
		Name:      a.cfg.App.Name,
		Version:   a.cfg.App.Version,
		GitSHA:    a.cfg.App.GitSHA,
		BuildTime: a.cfg.App.BuildTime,
	})
}

func (a *App) handleAuth(w http.ResponseWriter, r *http.Request, appMode bool, segments []string) {
	if appMode {
		if len(segments) == 1 && segments[0] == "me" && r.Method == http.MethodGet {
			status, err := a.auth.CurrentAppStatus(r)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, status)
			return
		}
		writeMethodNotAllowed(w)
		return
	}

	if len(segments) != 1 {
		http.NotFound(w, r)
		return
	}
	switch segments[0] {
	case "login":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.LoginRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		status, err := a.auth.Login(w, r, request)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, status)
	case "me":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		writeJSON(w, http.StatusOK, a.auth.CurrentWebStatus(r))
	case "logout":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		a.auth.Logout(w, r)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		http.NotFound(w, r)
	}
}

func (a *App) handleSessions(w http.ResponseWriter, r *http.Request, appMode bool, segments []string) {
	if len(segments) == 0 {
		switch r.Method {
		case http.MethodPost:
			var request model.CreateSessionRequest
			if err := decodeJSON(r, &request); err != nil {
				writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
				return
			}
			response, err := a.sessions.CreateSession(request)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, response)
		case http.MethodGet:
			writeJSON(w, http.StatusOK, a.sessions.ListSessions())
		default:
			writeMethodNotAllowed(w)
		}
		return
	}

	if len(segments) == 1 && segments[0] == "recent" {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		response, err := a.sessions.ListRecentSessions(r.URL.Query().Get("toolId"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
		return
	}

	sessionID := segments[0]
	if len(segments) == 1 {
		if r.Method != http.MethodDelete {
			writeMethodNotAllowed(w)
			return
		}
		if err := a.sessions.CloseSession(sessionID, "deleted by api", true); err != nil {
			writeError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	switch segments[1] {
	case "snapshot":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		afterSeq, _ := strconv.ParseInt(r.URL.Query().Get("afterSeq"), 10, 64)
		response, err := a.sessions.GetSnapshot(sessionID, afterSeq)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "transcript":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		afterSeq, _ := strconv.ParseInt(r.URL.Query().Get("afterSeq"), 10, 64)
		stripAnsi := parseBool(r.URL.Query().Get("stripAnsi"))
		response, err := a.sessions.GetTranscript(sessionID, afterSeq, stripAnsi)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "screen-text":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		response, err := a.sessions.GetScreenText(sessionID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "context":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		commandLimit := parseIntWithDefault(r.URL.Query().Get("commandLimit"), 100)
		eventLimit := parseIntWithDefault(r.URL.Query().Get("eventLimit"), 200)
		response, err := a.sessions.GetContext(sessionID, commandLimit, eventLimit)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "files":
		a.handleSessionFiles(w, r, appMode, sessionID, segments[2:])
	case "assist":
		a.handleAssist(w, r, sessionID, segments[2:])
	case "agent":
		a.handleAgent(w, r, sessionID, segments[2:])
	default:
		http.NotFound(w, r)
	}
}

func (a *App) handleAssist(w http.ResponseWriter, r *http.Request, sessionID string, segments []string) {
	if len(segments) != 1 || segments[0] != "suggestions" || r.Method != http.MethodPost {
		if len(segments) == 1 && segments[0] == "suggestions" {
			writeMethodNotAllowed(w)
			return
		}
		http.NotFound(w, r)
		return
	}

	var request model.CreateAssistSuggestionsRequest
	if err := decodeJSON(r, &request); err != nil && err != errEmptyBody {
		writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
		return
	}

	response, err := a.assist.CreateSuggestions(sessionID, request)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) handleSessionFiles(w http.ResponseWriter, r *http.Request, appMode bool, sessionID string, segments []string) {
	if len(segments) == 0 {
		http.NotFound(w, r)
		return
	}
	apiPrefix := "/term/api"
	if appMode {
		apiPrefix = "/appterm/api"
	}

	switch segments[0] {
	case "tree":
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		response, err := a.files.Tree(sessionID, r.URL.Query().Get("path"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "upload":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		if err := r.ParseMultipartForm(a.cfg.Terminal.Files.MaxUploadRequestBytes); err != nil {
			writeError(w, util.NewStatusError(http.StatusRequestEntityTooLarge, "upload request exceeds maxUploadRequestBytes", err))
			return
		}
		policy := model.UploadConflictPolicy(r.FormValue("conflictPolicy"))
		if policy == "" {
			policy = model.UploadConflictPolicyOverwrite
		}
		headers := r.MultipartForm.File["files"]
		response, err := a.files.Upload(sessionID, r.FormValue("targetPath"), policy, headers)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "download":
		switch r.Method {
		case http.MethodHead, http.MethodGet:
			var handle *files.DownloadHandle
			var err error
			if ticket := strings.TrimSpace(r.URL.Query().Get("ticket")); ticket != "" {
				payload, ticketErr := a.files.ConsumeDownloadTicket(ticket, sessionID, "single")
				if ticketErr != nil {
					writeError(w, ticketErr)
					return
				}
				handle, err = a.files.OpenDownload(sessionID, payload.Path)
			} else {
				handle, err = a.files.OpenDownload(sessionID, r.URL.Query().Get("path"))
			}
			if err != nil {
				writeError(w, err)
				return
			}
			defer handle.Close()
			applyDownloadHeaders(w, handle.FileName, handle.Size, "application/octet-stream")
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusOK)
			_, _ = io.Copy(w, handle.Reader)
		default:
			writeMethodNotAllowed(w)
		}
	case "download-archive":
		switch r.Method {
		case http.MethodPost:
			var request model.FileDownloadArchiveRequest
			if err := decodeJSON(r, &request); err != nil {
				writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
				return
			}
			archiveName := normalizedArchiveName(request.ArchiveName)
			entries, _, err := a.files.ArchiveEntries(sessionID, request.Paths)
			if err != nil {
				writeError(w, err)
				return
			}
			applyDownloadHeaders(w, archiveName, -1, "application/zip")
			w.WriteHeader(http.StatusOK)
			if err := files.StreamArchive(w, entries); err != nil {
				return
			}
		case http.MethodGet:
			ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
			payload, err := a.files.ConsumeDownloadTicket(ticket, sessionID, "archive")
			if err != nil {
				writeError(w, err)
				return
			}
			archiveName := normalizedArchiveName(payload.ArchiveName)
			entries, _, err := a.files.ArchiveEntries(sessionID, payload.Paths)
			if err != nil {
				writeError(w, err)
				return
			}
			applyDownloadHeaders(w, archiveName, -1, "application/zip")
			w.WriteHeader(http.StatusOK)
			if err := files.StreamArchive(w, entries); err != nil {
				return
			}
		default:
			writeMethodNotAllowed(w)
		}
	case "mkdir":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.FileMkdirRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.files.Mkdir(sessionID, request.ParentPath, request.Name)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "download-ticket":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.FileDownloadTicketRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.files.CreateDownloadTicket(sessionID, request, apiPrefix)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, response)
	default:
		http.NotFound(w, r)
	}
}

func (a *App) handleAgent(w http.ResponseWriter, r *http.Request, sessionID string, segments []string) {
	if len(segments) == 0 || segments[0] != "runs" {
		http.NotFound(w, r)
		return
	}
	if len(segments) == 1 {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.CreateAgentRunRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.agent.CreateRun(sessionID, request)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, response)
		return
	}

	runID := segments[1]
	if len(segments) == 2 {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}
		response, err := a.agent.GetRun(sessionID, runID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
		return
	}

	switch segments[2] {
	case "approve":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.ApproveAgentRunRequest
		if err := decodeJSON(r, &request); err != nil && err != errEmptyBody {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.agent.ApproveNextStep(sessionID, runID, request)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "abort":
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.AbortAgentRunRequest
		if err := decodeJSON(r, &request); err != nil && err != errEmptyBody {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.agent.Abort(sessionID, runID, request)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	default:
		http.NotFound(w, r)
	}
}

func (a *App) handleSSH(w http.ResponseWriter, r *http.Request, segments []string) {
	if len(segments) == 0 {
		http.NotFound(w, r)
		return
	}
	if segments[0] == "exec" {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.SshExecRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.ssh.Exec(request)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
		return
	}
	if segments[0] != "credentials" {
		http.NotFound(w, r)
		return
	}
	if len(segments) == 1 {
		switch r.Method {
		case http.MethodGet:
			response, err := a.ssh.ListCredentials()
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, response)
		case http.MethodPost:
			var request model.CreateSshCredentialRequest
			if err := decodeJSON(r, &request); err != nil {
				writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
				return
			}
			response, err := a.ssh.CreateCredential(request)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, response)
		default:
			writeMethodNotAllowed(w)
		}
		return
	}

	credentialID := segments[1]
	if len(segments) == 2 {
		if r.Method != http.MethodDelete {
			writeMethodNotAllowed(w)
			return
		}
		if err := a.ssh.DeleteCredential(credentialID); err != nil {
			writeError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(segments) == 3 && segments[2] == "preflight" {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		response, err := a.ssh.Preflight(credentialID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
		return
	}
	http.NotFound(w, r)
}

func (a *App) handleTerminal(w http.ResponseWriter, r *http.Request, segments []string) {
	if len(segments) != 1 || segments[0] != "clients" || r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	clients := make([]model.TerminalClientResponse, 0, len(a.cfg.Terminal.CliClients))
	for _, client := range a.cfg.Terminal.CliClients {
		if strings.TrimSpace(client.ID) == "" {
			continue
		}
		defaultWorkdir := client.Workdir
		if strings.TrimSpace(defaultWorkdir) == "" {
			defaultWorkdir = a.cfg.Terminal.DefaultWorkdir
		}
		clients = append(clients, model.TerminalClientResponse{
			ID:             strings.TrimSpace(client.ID),
			Label:          fallbackString(client.Label, client.ID),
			DefaultWorkdir: defaultWorkdir,
		})
	}
	writeJSON(w, http.StatusOK, clients)
}

func (a *App) handleWorkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeMethodNotAllowed(w)
		return
	}
	response, err := a.workdir.Browse(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) handleWorkspace(w http.ResponseWriter, r *http.Request, segments []string) {
	if len(segments) != 1 || segments[0] != "context-pack" || r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	var request model.ContextPackRequest
	if err := decodeJSON(r, &request); err != nil && err != errEmptyBody {
		writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
		return
	}
	response, err := a.workspace.Pack(request)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (a *App) handleWS(w http.ResponseWriter, r *http.Request) {
	if _, err := a.auth.AuthenticateWSToken(r); err != nil {
		writeError(w, err)
		return
	}
	sessionID := strings.TrimPrefix(r.URL.Path, "/ws/")
	if strings.TrimSpace(sessionID) == "" {
		writeError(w, util.NewStatusError(http.StatusBadRequest, "missing session id in websocket path", nil))
		return
	}
	conn, err := a.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	clientID := strings.TrimSpace(r.URL.Query().Get("clientId"))
	lastSeenSeq, _ := strconv.ParseInt(r.URL.Query().Get("lastSeenSeq"), 10, 64)
	if err := a.sessions.AttachWebSocket(sessionID, clientID, conn, lastSeenSeq); err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "message": util.ErrorMessage(err, "session error")})
		_ = conn.Close()
		return
	}

	go func() {
		defer func() {
			a.sessions.DetachWebSocket(sessionID, clientID, conn)
			_ = conn.Close()
		}()
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var envelope map[string]any
			if err := json.Unmarshal(payload, &envelope); err != nil {
				_ = conn.WriteJSON(map[string]string{"type": "error", "message": "Unsupported message type"})
				continue
			}
			switch envelope["type"] {
			case "input":
				data, _ := envelope["data"].(string)
				if err := a.sessions.WriteInput(sessionID, data); err != nil {
					_ = conn.WriteJSON(map[string]string{"type": "error", "message": util.ErrorMessage(err, "session error")})
				}
			case "resize":
				cols := toInt(envelope["cols"])
				rows := toInt(envelope["rows"])
				if err := a.sessions.Resize(sessionID, cols, rows); err != nil {
					_ = conn.WriteJSON(map[string]string{"type": "error", "message": util.ErrorMessage(err, "session error")})
				}
			case "ping":
				_ = conn.WriteJSON(map[string]string{"type": "pong"})
			default:
				_ = conn.WriteJSON(map[string]string{"type": "error", "message": "Unsupported message type"})
			}
		}
	}()
}

func (a *App) applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return
	}
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,POST,DELETE,OPTIONS")
}

var errEmptyBody = util.NewStatusError(http.StatusBadRequest, "empty body", nil)

func decodeJSON(r *http.Request, target any) error {
	if r.Body == nil {
		return errEmptyBody
	}
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		if err.Error() == "EOF" {
			return errEmptyBody
		}
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, err error) {
	status := util.ErrorStatus(err)
	message := util.ErrorMessage(err, "internal error")
	writeJSON(w, status, map[string]string{"error": message})
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeError(w, util.NewStatusError(http.StatusMethodNotAllowed, "method not allowed", nil))
}

func splitPath(value string) []string {
	trimmed := strings.Trim(value, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

func parseBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func parseIntWithDefault(value string, fallback int) int {
	if parsed, err := strconv.Atoi(strings.TrimSpace(value)); err == nil {
		return parsed
	}
	return fallback
}

func normalizedArchiveName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "download.zip"
	}
	if !strings.HasSuffix(strings.ToLower(name), ".zip") {
		name += ".zip"
	}
	return name
}

func applyDownloadHeaders(w http.ResponseWriter, fileName string, size int64, contentType string) {
	w.Header().Set("Content-Disposition", `attachment; filename="`+fileName+`"`)
	if size >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Generated-At", time.Now().UTC().Format(time.RFC3339))
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
}

func fallbackString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return strings.TrimSpace(fallback)
	}
	return strings.TrimSpace(value)
}

func isTicketDownloadRequest(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if strings.TrimSpace(r.URL.Query().Get("ticket")) == "" {
		return false
	}
	return strings.HasSuffix(r.URL.Path, "/files/download") || strings.HasSuffix(r.URL.Path, "/files/download-archive")
}

func toInt(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}
