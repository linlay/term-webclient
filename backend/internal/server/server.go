package server

import (
	"net/http"

	"github.com/gorilla/websocket"

	"term-webclient-go/backend/internal/agent"
	"term-webclient-go/backend/internal/assist"
	"term-webclient-go/backend/internal/auth"
	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/copilot"
	"term-webclient-go/backend/internal/files"
	"term-webclient-go/backend/internal/session"
	sshsvc "term-webclient-go/backend/internal/ssh"
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
	copilot   *copilot.Service
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
	copilotService := copilot.New(cfg, sessionService)

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
		copilot:   copilotService,
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
