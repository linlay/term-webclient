package copilot

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/session"
	"term-webclient-go/backend/internal/util"
)

func TestListChatsPrefersRequestAuthorizationHeader(t *testing.T) {
	var capturedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/api/ap/chats" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("agentKey"); got != "terminal-assistant" {
			t.Fatalf("unexpected agentKey query: %s", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"msg":  "success",
			"data": []map[string]any{{
				"chatId":         "chat-1",
				"chatName":       "Chat 1",
				"agentKey":       "terminal-assistant",
				"createdAt":      1,
				"updatedAt":      2,
				"lastRunId":      "run-1",
				"lastRunContent": "done",
				"readStatus":     1,
			}},
		})
	}))
	defer server.Close()

	svc := newTestService(server.URL, &stubSessions{
		exists: true,
	})
	svc.cfg.Copilot.Runner.AuthorizationBearer = "fallback-token"

	response, err := svc.ListChats("s1", "terminal-assistant", "", "Bearer request-token")
	if err != nil {
		t.Fatalf("ListChats returned error: %v", err)
	}
	if capturedAuth != "Bearer request-token" {
		t.Fatalf("expected request authorization header, got %q", capturedAuth)
	}
	if len(response) != 1 || response[0].ChatID != "chat-1" {
		t.Fatalf("unexpected chats response: %#v", response)
	}
}

func TestListChatsFallsBackToConfiguredAuthorizationBearer(t *testing.T) {
	var capturedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"msg":  "success",
			"data": []map[string]any{},
		})
	}))
	defer server.Close()

	svc := newTestService(server.URL, &stubSessions{
		exists: true,
	})
	svc.cfg.Copilot.Runner.AuthorizationBearer = "runner-secret"

	if _, err := svc.ListChats("s1", "terminal-assistant", "", ""); err != nil {
		t.Fatalf("ListChats returned error: %v", err)
	}
	if capturedAuth != "Bearer runner-secret" {
		t.Fatalf("expected configured bearer fallback, got %q", capturedAuth)
	}
}

func TestProxyQueryMapsConfiguredAgentKeyAndStreamsResponse(t *testing.T) {
	var requestBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/ap/query" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"type\":\"chat.start\",\"chatId\":\"chat-1\"}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	svc := newTestService(server.URL, &stubSessions{
		exists: true,
		session: &session.Session{
			SessionID:   "s1",
			SessionType: model.SessionTypeLocalPTY,
			ToolID:      "terminal",
		},
	})
	recorder := httptest.NewRecorder()

	err := svc.ProxyQuery(context.Background(), recorder, "s1", model.CopilotQueryRequest{
		AgentKey: "terminal-assistant",
		ChatID:   "chat-1",
		Message:  "check repo",
	}, "")
	if err != nil {
		t.Fatalf("ProxyQuery returned error: %v", err)
	}
	if got := requestBody["agentKey"]; got != "terminal-assistant" {
		t.Fatalf("expected runner agent key passthrough, got %#v", got)
	}
	if got := requestBody["stream"]; got != true {
		t.Fatalf("expected stream=true, got %#v", got)
	}
	if !strings.Contains(recorder.Body.String(), "\"chatId\":\"chat-1\"") {
		t.Fatalf("expected proxied sse payload, got %q", recorder.Body.String())
	}
}

func TestExecuteCommandReturnsTranscriptAndExitCode(t *testing.T) {
	stub := &stubSessions{
		exists: true,
		session: &session.Session{
			SessionID:   "s1",
			SessionType: model.SessionTypeLocalPTY,
			ToolID:      "terminal",
		},
	}
	stub.writeHook = func(_ string, data string) error {
		marker := ExtractCommandMarker(data)
		if marker == "" {
			t.Fatalf("expected wrapped command marker in %q", data)
		}
		stub.appendOutput("running\n" + marker + ":0\n")
		return nil
	}

	svc := newTestService("https://runner.invalid", stub)
	response, err := svc.ExecuteCommand("s1", model.CopilotExecuteCommandRequest{Command: "pwd"})
	if err != nil {
		t.Fatalf("ExecuteCommand returned error: %v", err)
	}
	if response.ExitCode != 0 {
		t.Fatalf("expected exit code 0, got %d", response.ExitCode)
	}
	if !strings.Contains(response.TranscriptDelta, "running") {
		t.Fatalf("expected transcript delta to include output, got %q", response.TranscriptDelta)
	}
}

func TestExecuteCommandSupportsSshSessionAndNonZeroExit(t *testing.T) {
	stub := &stubSessions{
		exists: true,
		session: &session.Session{
			SessionID:   "s1",
			SessionType: model.SessionTypeSSHShell,
			ToolID:      "ssh",
		},
	}
	stub.writeHook = func(_ string, data string) error {
		marker := ExtractCommandMarker(data)
		stub.appendOutput("failed\n" + marker + ":17\n")
		return nil
	}

	svc := newTestService("https://runner.invalid", stub)
	response, err := svc.ExecuteCommand("s1", model.CopilotExecuteCommandRequest{Command: "false"})
	if err != nil {
		t.Fatalf("ExecuteCommand returned error: %v", err)
	}
	if response.ExitCode != 17 {
		t.Fatalf("expected exit code 17, got %d", response.ExitCode)
	}
}

func TestExecuteCommandTimesOutWithoutCompletionMarker(t *testing.T) {
	stub := &stubSessions{
		exists: true,
		session: &session.Session{
			SessionID:   "s1",
			SessionType: model.SessionTypeLocalPTY,
			ToolID:      "terminal",
		},
	}
	stub.writeHook = func(_ string, _ string) error {
		stub.appendOutput("still running\n")
		return nil
	}

	svc := newTestService("https://runner.invalid", stub)
	timeout := 1
	if _, err := svc.ExecuteCommand("s1", model.CopilotExecuteCommandRequest{
		Command:        "sleep 10",
		TimeoutSeconds: &timeout,
	}); err == nil || !strings.Contains(err.Error(), "completion marker") {
		t.Fatalf("expected completion marker timeout error, got %v", err)
	}
}

func TestProxyQueryRejectsNonShellTabs(t *testing.T) {
	svc := newTestService("https://runner.invalid", &stubSessions{
		exists: true,
		session: &session.Session{
			SessionID:   "s1",
			SessionType: model.SessionTypeLocalPTY,
			ToolID:      "codex",
		},
	})

	err := svc.ProxyQuery(context.Background(), httptest.NewRecorder(), "s1", model.CopilotQueryRequest{
		AgentKey: "terminal-assistant",
		Message:  "hello",
	}, "")
	if util.ErrorStatus(err) != http.StatusBadRequest {
		t.Fatalf("expected bad request for non-shell tab, got %v", err)
	}
}

func TestListChatsRejectsUnknownAgentKey(t *testing.T) {
	svc := newTestService("https://runner.invalid", &stubSessions{
		exists: true,
	})

	_, err := svc.ListChats("s1", "missing-agent", "", "")
	if util.ErrorStatus(err) != http.StatusBadRequest {
		t.Fatalf("expected bad request for unknown agent key, got %v", err)
	}
}

func newTestService(baseURL string, sessions *stubSessions) *Service {
	cfg := &config.Config{
		Copilot: config.CopilotConfig{
			Runner: config.CopilotRunnerConfig{
				BaseURL:        baseURL,
				TimeoutSeconds: 5,
			},
			Agents: []config.CopilotAgentConfig{
				{
					Key:     "default-assist",
					Label:   "Default Assist",
					Type:    "builtin_assist",
					Default: true,
				},
				{
					Key:     "terminal-assistant",
					Label:   "Terminal Assistant",
					Type:    "runner_agent",
					Default: false,
				},
			},
		},
		Terminal: config.TerminalConfig{
			Agent: config.AgentConfig{
				StepTimeoutSeconds: 1,
			},
		},
	}
	svc := New(cfg, sessions)
	return svc
}

type stubSessions struct {
	exists    bool
	session   *session.Session
	writeHook func(sessionID, data string) error

	mu     sync.Mutex
	output []model.TerminalOutputChunk
}

func (s *stubSessions) Exists(sessionID string) bool {
	if !s.exists {
		return false
	}
	if s.session == nil {
		return true
	}
	return s.session.SessionID == sessionID
}

func (s *stubSessions) GetRequiredSession(sessionID string) (*session.Session, error) {
	if !s.Exists(sessionID) {
		return nil, util.NewStatusError(http.StatusNotFound, "session not found", nil)
	}
	return s.session, nil
}

func (s *stubSessions) WriteInputFromAgent(sessionID, data string) error {
	if !s.Exists(sessionID) {
		return util.NewStatusError(http.StatusNotFound, "session not found", nil)
	}
	if s.writeHook != nil {
		return s.writeHook(sessionID, data)
	}
	return nil
}

func (s *stubSessions) GetSnapshot(sessionID string, afterSeq int64) (model.SessionSnapshotResponse, error) {
	if !s.Exists(sessionID) {
		return model.SessionSnapshotResponse{}, util.NewStatusError(http.StatusNotFound, "session not found", nil)
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	chunks := make([]model.TerminalOutputChunk, 0, len(s.output))
	for _, chunk := range s.output {
		if chunk.Seq > afterSeq {
			chunks = append(chunks, chunk)
		}
	}
	fromSeq := afterSeq
	toSeq := afterSeq
	if len(chunks) > 0 {
		fromSeq = chunks[0].Seq
		toSeq = chunks[len(chunks)-1].Seq
	}
	return model.SessionSnapshotResponse{
		SessionID: sessionID,
		FromSeq:   fromSeq,
		ToSeq:     toSeq,
		Chunks:    chunks,
	}, nil
}

func (s *stubSessions) appendOutput(data string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	nextSeq := int64(len(s.output) + 1)
	s.output = append(s.output, model.TerminalOutputChunk{
		Seq:  nextSeq,
		Data: data,
	})
	if s.session != nil {
		s.session.NextSeq.Store(nextSeq)
	}
}

func TestExtractCommandCompletionIgnoresIncompleteMarker(t *testing.T) {
	if _, _, ok := extractCommandCompletion("hello __TWC_COPILOT_EXIT_x__", "__TWC_COPILOT_EXIT_x__"); ok {
		t.Fatal("expected incomplete marker to be ignored")
	}
}

func TestExecuteCommandSerializesPerSession(t *testing.T) {
	stub := &stubSessions{
		exists: true,
		session: &session.Session{
			SessionID:   "s1",
			SessionType: model.SessionTypeLocalPTY,
			ToolID:      "terminal",
		},
	}
	var order []string
	var orderMu sync.Mutex
	stub.writeHook = func(_ string, data string) error {
		marker := ExtractCommandMarker(data)
		orderMu.Lock()
		order = append(order, marker)
		orderMu.Unlock()
		time.Sleep(150 * time.Millisecond)
		stub.appendOutput(marker + ":0\n")
		return nil
	}

	svc := newTestService("https://runner.invalid", stub)
	timeout := 1
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = svc.ExecuteCommand("s1", model.CopilotExecuteCommandRequest{Command: "pwd", TimeoutSeconds: &timeout})
	}()
	go func() {
		defer wg.Done()
		_, _ = svc.ExecuteCommand("s1", model.CopilotExecuteCommandRequest{Command: "ls", TimeoutSeconds: &timeout})
	}()
	wg.Wait()

	orderMu.Lock()
	defer orderMu.Unlock()
	if len(order) != 2 {
		t.Fatalf("expected two serialized writes, got %d", len(order))
	}
}
