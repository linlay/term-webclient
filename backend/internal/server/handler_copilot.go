package server

import (
	"net/http"

	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

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

func (a *App) handleCopilot(w http.ResponseWriter, r *http.Request, sessionID string, segments []string) {
	if len(segments) == 0 {
		http.NotFound(w, r)
		return
	}

	authHeader := r.Header.Get("Authorization")
	switch segments[0] {
	case "agents":
		if r.Method != http.MethodGet || len(segments) != 1 {
			if len(segments) == 1 {
				writeMethodNotAllowed(w)
				return
			}
			http.NotFound(w, r)
			return
		}
		response, err := a.copilot.ListAgents(sessionID)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "chats":
		if len(segments) == 1 {
			if r.Method != http.MethodGet {
				writeMethodNotAllowed(w)
				return
			}
			response, err := a.copilot.ListChats(sessionID, r.URL.Query().Get("agentKey"), r.URL.Query().Get("lastRunId"), authHeader)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, response)
			return
		}
		if len(segments) != 2 || r.Method != http.MethodGet {
			if len(segments) == 2 {
				writeMethodNotAllowed(w)
				return
			}
			http.NotFound(w, r)
			return
		}
		response, err := a.copilot.GetChat(sessionID, segments[1], authHeader)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "query":
		if len(segments) != 1 || r.Method != http.MethodPost {
			if len(segments) == 1 {
				writeMethodNotAllowed(w)
				return
			}
			http.NotFound(w, r)
			return
		}
		var request model.CopilotQueryRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		if err := a.copilot.ProxyQuery(r.Context(), w, sessionID, request, authHeader); err != nil {
			writeError(w, err)
		}
	case "submit":
		if len(segments) != 1 || r.Method != http.MethodPost {
			if len(segments) == 1 {
				writeMethodNotAllowed(w)
				return
			}
			http.NotFound(w, r)
			return
		}
		var request model.CopilotSubmitRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.copilot.Submit(sessionID, request, authHeader)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	case "commands":
		if len(segments) != 2 || segments[1] != "execute" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}
		var request model.CopilotExecuteCommandRequest
		if err := decodeJSON(r, &request); err != nil {
			writeError(w, util.NewStatusError(http.StatusBadRequest, "invalid request body", err))
			return
		}
		response, err := a.copilot.ExecuteCommand(sessionID, request)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, response)
	default:
		http.NotFound(w, r)
	}
}
