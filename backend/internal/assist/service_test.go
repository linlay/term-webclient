package assist

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

type stubScreenTextProvider struct {
	response model.ScreenTextResponse
	err      error
}

func (s stubScreenTextProvider) GetScreenText(sessionID string) (model.ScreenTextResponse, error) {
	_ = sessionID
	return s.response, s.err
}

func TestCreateSuggestionsTruncatesRecentScreenTextAndPadsToFive(t *testing.T) {
	var requestBody map[string]any
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"git status --short\",\"reason\":\"Check repo state.\"}"}}]}`)
		writeSSEData(t, w, `{"choices":[{"delta":{"content":",{\"command\":\"git diff --stat\",\"reason\":\"Inspect diff summary.\"}]}"}}]}`)
		writeSSEDone(t, w)
	}, &requestBody)
	defer server.Close()

	longScreenText := strings.Repeat("a", 520)
	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            server.URL,
		APIKey:             "test-key",
		Model:              "gpt-test",
		TimeoutSeconds:     5,
		MaxScreenTextChars: 500,
	}, stubScreenTextProvider{
		response: model.ScreenTextResponse{
			SessionID: "s1",
			Text:      longScreenText,
		},
	})

	response, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{})
	if err != nil {
		t.Fatalf("CreateSuggestions returned error: %v", err)
	}

	if response.CapturedChars != 500 {
		t.Fatalf("expected captured chars to be 500, got %d", response.CapturedChars)
	}
	if len(response.Suggestions) < 5 {
		t.Fatalf("expected at least 5 suggestions, got %d", len(response.Suggestions))
	}

	assertRequestMessages(t, requestBody, strings.Repeat("a", 500), "(none)")
	if requestBody["stream"] != true {
		t.Fatalf("expected stream=true, got %#v", requestBody["stream"])
	}
}

func TestCreateSuggestionsCustomSystemPromptStillAppendsJSONInstruction(t *testing.T) {
	var requestBody map[string]any
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"pwd\",\"reason\":\"Confirm current directory.\"},{\"command\":\"ls -la\",\"reason\":\"List files.\"},{\"command\":\"npm test\",\"reason\":\"Run tests.\"},{\"command\":\"git status --short\",\"reason\":\"Check repo state.\"},{\"command\":\"go test ./...\",\"reason\":\"Run Go tests.\"}]}"}}]}`)
		writeSSEDone(t, w)
	}, &requestBody)
	defer server.Close()

	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            server.URL,
		APIKey:             "test-key",
		Model:              "gpt-test",
		TimeoutSeconds:     5,
		MaxScreenTextChars: 500,
		SystemPrompt:       "Follow local repository conventions.",
	}, stubScreenTextProvider{
		response: model.ScreenTextResponse{
			SessionID: "s1",
			Text:      "git status output",
		},
	})

	if _, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{}); err != nil {
		t.Fatalf("CreateSuggestions returned error: %v", err)
	}

	messages, ok := requestBody["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("unexpected messages payload: %#v", requestBody["messages"])
	}
	systemMessage, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("unexpected system message payload: %#v", messages[0])
	}
	content, _ := systemMessage["content"].(string)
	if !strings.Contains(content, "Follow local repository conventions.") {
		t.Fatalf("expected custom system prompt, got %q", content)
	}
	if !strings.Contains(strings.ToLower(content), "json") {
		t.Fatalf("expected json constraint in system prompt, got %q", content)
	}
}

func TestCreateSuggestionsAllowsEmptyQuestionAndUsesModelResponse(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"pwd\",\"reason\":\"Confirm current directory.\"},{\"command\":\"ls -la\",\"reason\":\"List files.\"}"}}]}`)
		writeSSEData(t, w, `{"choices":[{"delta":{"content":",{\"command\":\"npm test\",\"reason\":\"Run tests.\"},{\"command\":\"git status --short\",\"reason\":\"Check repo state.\"},{\"command\":\"go test ./...\",\"reason\":\"Run Go tests.\"}]}"}}]}`)
		writeSSEDone(t, w)
	}, nil)
	defer server.Close()

	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            server.URL,
		APIKey:             "test-key",
		Model:              "gpt-test",
		TimeoutSeconds:     5,
		MaxScreenTextChars: 500,
	}, stubScreenTextProvider{
		response: model.ScreenTextResponse{
			SessionID: "s1",
			Text:      "git status output",
		},
	})

	response, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{})
	if err != nil {
		t.Fatalf("CreateSuggestions returned error: %v", err)
	}
	if response.CapturedScreenText != "git status output" {
		t.Fatalf("unexpected captured screen text: %q", response.CapturedScreenText)
	}
	if response.Suggestions[0].Command != "pwd" {
		t.Fatalf("unexpected first suggestion: %+v", response.Suggestions[0])
	}
}

func TestCreateSuggestionsReturnsBadGatewayWhenModelJSONIsInvalid(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"not-json"}}]}`)
		writeSSEDone(t, w)
	}, nil)
	defer server.Close()

	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            server.URL,
		APIKey:             "test-key",
		Model:              "gpt-test",
		TimeoutSeconds:     5,
		MaxScreenTextChars: 500,
	}, stubScreenTextProvider{
		response: model.ScreenTextResponse{
			SessionID: "s1",
			Text:      "recent text",
		},
	})

	_, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{
		Question: "What should I do next?",
	})
	if util.ErrorStatus(err) != http.StatusBadGateway {
		t.Fatalf("expected bad gateway error, got %d (%v)", util.ErrorStatus(err), err)
	}
}

func TestCreateSuggestionsReturnsBadGatewayWhenStreamPayloadIsInvalid(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `not-json`)
		writeSSEDone(t, w)
	}, nil)
	defer server.Close()

	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            server.URL,
		APIKey:             "test-key",
		Model:              "gpt-test",
		TimeoutSeconds:     5,
		MaxScreenTextChars: 500,
	}, stubScreenTextProvider{
		response: model.ScreenTextResponse{
			SessionID: "s1",
			Text:      "recent text",
		},
	})

	_, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{})
	if util.ErrorStatus(err) != http.StatusBadGateway {
		t.Fatalf("expected bad gateway error, got %d (%v)", util.ErrorStatus(err), err)
	}
	if !strings.Contains(util.ErrorMessage(err, ""), "stream payload is invalid") {
		t.Fatalf("expected invalid payload error, got %v", err)
	}
}

func TestCreateSuggestionsReturnsBadGatewayWhenStreamEndsWithoutDone(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"pwd\",\"reason\":\"Confirm current directory.\"}]}"}}]}`)
	}, nil)
	defer server.Close()

	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            server.URL,
		APIKey:             "test-key",
		Model:              "gpt-test",
		TimeoutSeconds:     5,
		MaxScreenTextChars: 500,
	}, stubScreenTextProvider{
		response: model.ScreenTextResponse{
			SessionID: "s1",
			Text:      "recent text",
		},
	})

	_, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{})
	if util.ErrorStatus(err) != http.StatusBadGateway {
		t.Fatalf("expected bad gateway error, got %d (%v)", util.ErrorStatus(err), err)
	}
	if !strings.Contains(util.ErrorMessage(err, ""), "stream ended before completion") {
		t.Fatalf("expected incomplete stream error, got %v", err)
	}
}

func TestCreateSuggestionsDebugLogRedactsAuthorization(t *testing.T) {
	var requestBody map[string]any
	var logs strings.Builder
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"pwd\",\"reason\":\"Confirm current directory.\"},{\"command\":\"ls -la\",\"reason\":\"List files.\"},{\"command\":\"npm test\",\"reason\":\"Run tests.\"},{\"command\":\"git status --short\",\"reason\":\"Check repo state.\"},{\"command\":\"go test ./...\",\"reason\":\"Run Go tests.\"}]}"}}]}`)
		writeSSEDone(t, w)
	}, &requestBody)
	defer server.Close()

	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            server.URL,
		APIKey:             "super-secret-key",
		Model:              "gpt-test",
		TimeoutSeconds:     5,
		MaxScreenTextChars: 500,
		DebugLog:           true,
	}, stubScreenTextProvider{
		response: model.ScreenTextResponse{
			SessionID: "s1",
			Text:      "git status output",
		},
	})
	svc.logf = func(format string, args ...any) {
		logs.WriteString(fmt.Sprintf(format, args...))
		logs.WriteString("\n")
	}

	if _, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{}); err != nil {
		t.Fatalf("CreateSuggestions returned error: %v", err)
	}

	logOutput := logs.String()
	if !strings.Contains(logOutput, `assist debug session=s1 message[0] role=system`) {
		t.Fatalf("expected system prompt log, got %q", logOutput)
	}
	if !strings.Contains(logOutput, "Bearer ***") {
		t.Fatalf("expected redacted authorization header, got %q", logOutput)
	}
	if strings.Contains(logOutput, "super-secret-key") {
		t.Fatalf("expected api key to be redacted, got %q", logOutput)
	}
}

func TestResolveChatCompletionsEndpointKeepsVersionedBaseURL(t *testing.T) {
	testCases := []struct {
		name    string
		baseURL string
		want    string
	}{
		{
			name:    "versioned base url",
			baseURL: "https://api.babelark.com/v1",
			want:    "https://api.babelark.com/v1/chat/completions",
		},
		{
			name:    "already full endpoint",
			baseURL: "https://api.babelark.com/v1/chat/completions",
			want:    "https://api.babelark.com/v1/chat/completions",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveChatCompletionsEndpoint(tc.baseURL)
			if got != tc.want {
				t.Fatalf("expected endpoint %q, got %q", tc.want, got)
			}
		})
	}
}

func newAssistStreamServer(t *testing.T, handler func(w http.ResponseWriter, r *http.Request), requestBody *map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if requestBody != nil {
			var decoded map[string]any
			if err := decodeRequestBody(r, &decoded); err != nil {
				t.Fatalf("decode request body: %v", err)
			}
			*requestBody = decoded
		}
		w.Header().Set("Content-Type", "text/event-stream")
		handler(w, r)
	}))
}

func decodeRequestBody(r *http.Request, out *map[string]any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(out)
}

func writeSSEData(t *testing.T, w http.ResponseWriter, payload string) {
	t.Helper()
	if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
		t.Fatalf("write sse data: %v", err)
	}
	flushSSE(t, w)
}

func writeSSEDone(t *testing.T, w http.ResponseWriter) {
	t.Helper()
	writeSSEData(t, w, "[DONE]")
}

func flushSSE(t *testing.T, w http.ResponseWriter) {
	t.Helper()
	flusher, ok := w.(http.Flusher)
	if !ok {
		t.Fatal("response writer does not support flushing")
	}
	flusher.Flush()
}

func newTestService(assistCfg config.AssistConfig, sessions stubScreenTextProvider) *Service {
	return New(&config.Config{
		Assist: assistCfg,
	}, sessions)
}

func assertRequestMessages(t *testing.T, requestBody map[string]any, wantScreenText, wantQuestionMarker string) {
	t.Helper()
	messages, ok := requestBody["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("unexpected messages payload: %#v", requestBody["messages"])
	}
	systemMessage, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("unexpected system message payload: %#v", messages[0])
	}
	systemContent, _ := systemMessage["content"].(string)
	if !strings.Contains(strings.ToLower(systemContent), "json") {
		t.Fatalf("expected json constraint in system prompt, got %q", systemContent)
	}
	userMessage, ok := messages[1].(map[string]any)
	if !ok {
		t.Fatalf("unexpected user message payload: %#v", messages[1])
	}
	userContent, _ := userMessage["content"].(string)
	if !strings.Contains(userContent, wantScreenText) {
		t.Fatalf("expected truncated screen text in prompt")
	}
	if !strings.Contains(userContent, wantQuestionMarker) {
		t.Fatalf("expected question marker %q in prompt", wantQuestionMarker)
	}
}
