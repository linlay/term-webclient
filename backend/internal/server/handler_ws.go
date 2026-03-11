package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"term-webclient-go/backend/internal/util"
)

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
