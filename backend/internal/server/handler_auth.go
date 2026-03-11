package server

import (
	"net/http"

	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

func (a *App) handleAuth(w http.ResponseWriter, r *http.Request, segments []string) {
	if detectAPIMode(r.URL.Path) == apiModeApp {
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
