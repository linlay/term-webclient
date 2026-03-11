package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"term-webclient-go/backend/internal/util"
)

type apiMode string

const (
	apiModeWeb apiMode = "web"
	apiModeApp apiMode = "app"
)

var errEmptyBody = util.NewStatusError(http.StatusBadRequest, "empty body", nil)

func detectAPIMode(requestPath string) apiMode {
	if strings.HasPrefix(requestPath, "/appapi") {
		return apiModeApp
	}
	return apiModeWeb
}

func (mode apiMode) fileAPIPrefix() string {
	if mode == apiModeApp {
		return "/appterm/api"
	}
	return "/term/api"
}

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
