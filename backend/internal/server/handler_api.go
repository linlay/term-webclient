package server

import (
	"net/http"
	"strings"
)

func (a *App) handleWebAPI(w http.ResponseWriter, r *http.Request) {
	a.handleAPI(w, r, "/webapi")
}

func (a *App) handleAppAPI(w http.ResponseWriter, r *http.Request) {
	a.handleAPI(w, r, "/appapi")
}

func (a *App) handleAPI(w http.ResponseWriter, r *http.Request, prefix string) {
	a.applyCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	mode := detectAPIMode(r.URL.Path)
	path := strings.TrimPrefix(r.URL.Path, prefix)
	segments := splitPath(path)
	if len(segments) == 0 {
		http.NotFound(w, r)
		return
	}
	if !(len(segments) == 1 && segments[0] == "version") {
		if mode == apiModeApp {
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
		a.handleAuth(w, r, segments[1:])
	case "sessions":
		a.handleSessions(w, r, segments[1:])
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
