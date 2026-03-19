package session

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gorilla/websocket"

	"term-webclient-go/backend/internal/util"
)

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
