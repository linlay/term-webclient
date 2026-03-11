package server

import (
	"net/http"
	"strings"

	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

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
			Label:          util.FallbackString(client.Label, client.ID),
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
