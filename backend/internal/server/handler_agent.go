package server

import (
	"net/http"

	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

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
