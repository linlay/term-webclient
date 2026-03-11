package server

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"term-webclient-go/backend/internal/files"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

func (a *App) handleSessions(w http.ResponseWriter, r *http.Request, segments []string) {
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
		a.handleSessionFiles(w, r, sessionID, segments[2:])
	case "assist":
		a.handleAssist(w, r, sessionID, segments[2:])
	case "copilot":
		a.handleCopilot(w, r, sessionID, segments[2:])
	case "agent":
		a.handleAgent(w, r, sessionID, segments[2:])
	default:
		http.NotFound(w, r)
	}
}

func (a *App) handleSessionFiles(w http.ResponseWriter, r *http.Request, sessionID string, segments []string) {
	if len(segments) == 0 {
		http.NotFound(w, r)
		return
	}
	apiPrefix := detectAPIMode(r.URL.Path).fileAPIPrefix()

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
