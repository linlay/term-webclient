package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"term-webclient-go/backend/internal/config"
)

func TestAuthRoutesRespectAPIMode(t *testing.T) {
	app := newTestApp(t, func(cfg *config.Config) {
		cfg.Auth.Enabled = true
		cfg.AppAuth.Enabled = true
	})

	webReq := httptest.NewRequest(http.MethodGet, "/webapi/auth/me", nil)
	webRecorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(webRecorder, webReq)
	if webRecorder.Code != http.StatusOK {
		t.Fatalf("expected web auth status 200, got %d", webRecorder.Code)
	}
	var webStatus map[string]any
	if err := json.Unmarshal(webRecorder.Body.Bytes(), &webStatus); err != nil {
		t.Fatalf("decode web auth response: %v", err)
	}
	if authenticated, _ := webStatus["authenticated"].(bool); authenticated {
		t.Fatalf("expected unauthenticated web status, got %#v", webStatus)
	}

	appReq := httptest.NewRequest(http.MethodGet, "/appapi/auth/me", nil)
	appRecorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(appRecorder, appReq)
	if appRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected app auth status 401, got %d", appRecorder.Code)
	}
	if !strings.Contains(appRecorder.Body.String(), "unauthorized") {
		t.Fatalf("expected unauthorized app auth response, got %q", appRecorder.Body.String())
	}
}

func TestTicketDownloadBypassesWebAuth(t *testing.T) {
	app := newTestApp(t, func(cfg *config.Config) {
		cfg.Auth.Enabled = true
		cfg.Terminal.Files.Enabled = true
	})

	req := httptest.NewRequest(http.MethodGet, "/webapi/sessions/s1/files/download?ticket=missing", nil)
	recorder := httptest.NewRecorder()
	app.Handler().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected missing ticket status 404, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "download ticket not found") {
		t.Fatalf("expected missing ticket error, got %q", recorder.Body.String())
	}
}

func TestDownloadTicketUsesModeSpecificPrefix(t *testing.T) {
	app := newTestApp(t, func(cfg *config.Config) {
		cfg.Terminal.Files.Enabled = true
	})

	assertDownloadPrefix := func(requestPath, expectedPrefix string) {
		t.Helper()
		body := bytes.NewBufferString(`{"mode":"single","path":"/tmp/a.txt"}`)
		req := httptest.NewRequest(http.MethodPost, requestPath, body)
		req.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		app.Handler().ServeHTTP(recorder, req)
		if recorder.Code != http.StatusCreated {
			t.Fatalf("expected status 201 for %s, got %d body=%q", requestPath, recorder.Code, recorder.Body.String())
		}
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode download ticket response: %v", err)
		}
		downloadURL, _ := response["downloadUrl"].(string)
		if !strings.HasPrefix(downloadURL, expectedPrefix) {
			t.Fatalf("expected download url prefix %q, got %q", expectedPrefix, downloadURL)
		}
	}

	assertDownloadPrefix("/webapi/sessions/s1/files/download-ticket", "/term/api/sessions/s1/files/download?ticket=")
	assertDownloadPrefix("/appapi/sessions/s1/files/download-ticket", "/appterm/api/sessions/s1/files/download?ticket=")
}

func newTestApp(t *testing.T, mutate func(cfg *config.Config)) *App {
	t.Helper()
	root := t.TempDir()
	cfg := &config.Config{
		Server: config.ServerConfig{
			Address: "127.0.0.1",
			Port:    8080,
		},
		Terminal: config.TerminalConfig{
			DefaultCommand:         "sh",
			DefaultArgs:            []string{},
			DefaultWorkdir:         root,
			WorkdirBrowseRoot:      root,
			AllowedOrigins:         []string{"http://*", "https://*"},
			DetachedSessionTTL:     1,
			RingBufferMaxBytes:     1024,
			RingBufferMaxChunks:    16,
			MaxCols:                200,
			MaxRows:                100,
			SessionEventMaxEntries: 32,
			CommandFrameMaxEntries: 32,
			TranscriptMaxChars:     2048,
			RecentSessionsFile:     filepath.Join(root, "recent-sessions.json"),
			RecentSessionsPerTool:  5,
			Agent: config.AgentConfig{
				Enabled:             true,
				StepTimeoutSeconds:  5,
				MaxStepResultChars:  1024,
				MaxContextPackBytes: 64 * 1024,
			},
			SSH: config.SSHConfig{
				Enabled:                   true,
				DefaultPort:               22,
				DefaultTerm:               "xterm-256color",
				ConnectTimeoutMillis:      1000,
				ConnectionIdleTTLSeconds:  60,
				ExecDefaultTimeoutSeconds: 10,
				ExecMaxOutputBytes:        4096,
				CredentialsFile:           filepath.Join(root, "ssh-credentials.json"),
				KnownHostsFile:            filepath.Join(root, "known-hosts.json"),
			},
			Files: config.FilesConfig{
				Enabled:                  false,
				MaxUploadFileBytes:       1024,
				MaxUploadRequestBytes:    2048,
				MaxDownloadArchiveBytes:  8 * 1024,
				DefaultRootScope:         "SESSION_WORKDIR",
				AllowOutsideRoot:         true,
				AllowedRoots:             []string{},
				DownloadTicketTTLSeconds: 60,
			},
		},
		Copilot: config.CopilotConfig{
			Runner: config.CopilotRunnerConfig{
				BaseURL:        "https://runner.example",
				TimeoutSeconds: 5,
			},
			Agents: []config.CopilotAgentConfig{
				{
					Key:     "default-assist",
					Label:   "Default Assist",
					Type:    "builtin_assist",
					Default: true,
				},
			},
		},
		Assist: config.AssistConfig{
			TimeoutSeconds:     5,
			MaxScreenTextChars: 256,
		},
		Auth: config.AuthConfig{
			Enabled:                     false,
			Username:                    "admin",
			SessionTTLSeconds:           300,
			LoginRateLimitEnabled:       false,
			LoginRateLimitWindowSeconds: 60,
			LoginRateLimitMaxAttempts:   5,
		},
		AppAuth: config.AppAuthConfig{
			Enabled:          false,
			JWKSCacheSeconds: 60,
			ClockSkewSeconds: 0,
		},
		App: config.AppMetaConfig{
			Name:      "term-web-backend",
			Version:   "test",
			GitSHA:    "test",
			BuildTime: "test",
		},
	}
	if mutate != nil {
		mutate(cfg)
	}
	app, err := New(cfg)
	if err != nil {
		t.Fatalf("new app: %v", err)
	}
	t.Cleanup(func() {
		_ = app.Close()
	})
	return app
}
