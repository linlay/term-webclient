package assist

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	if len(response.Suggestions) != 5 {
		t.Fatalf("expected exactly 5 suggestions, got %d", len(response.Suggestions))
	}
	if response.Suggestions[0].Weight < response.Suggestions[1].Weight {
		t.Fatalf("expected suggestions to be sorted by weight desc, got %+v", response.Suggestions)
	}

	assertRequestMessages(t, requestBody, strings.Repeat("a", 500), "(none)")
	if requestBody["stream"] != true {
		t.Fatalf("expected stream=true, got %#v", requestBody["stream"])
	}
	if requestBody["enable_thinking"] != false {
		t.Fatalf("expected enable_thinking=false, got %#v", requestBody["enable_thinking"])
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
	if !strings.Contains(strings.ToLower(content), "weight") {
		t.Fatalf("expected weight constraint in system prompt, got %q", content)
	}
}

func TestCreateSuggestionsAllowsEmptyQuestionAndUsesModelResponse(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"pwd\",\"reason\":\"Confirm current directory.\",\"weight\":70},{\"command\":\"ls -la\",\"reason\":\"List files.\",\"weight\":60}"}}]}`)
		writeSSEData(t, w, `{"choices":[{"delta":{"content":",{\"command\":\"npm test\",\"reason\":\"Run tests.\",\"weight\":40},{\"command\":\"git status --short\",\"reason\":\"Check repo state.\",\"weight\":90},{\"command\":\"go test ./...\",\"reason\":\"Run Go tests.\",\"weight\":55}]}"}}]}`)
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
	if response.Suggestions[0].Command != "git status --short" || response.Suggestions[0].Weight != 90 {
		t.Fatalf("unexpected first suggestion: %+v", response.Suggestions[0])
	}
}

func TestCreateSuggestionsPadsToFiveAndRanksByWeight(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"git diff --stat\",\"reason\":\"Inspect the current diff summary.\",\"weight\":82},{\"command\":\"git status --short\",\"reason\":\"Check whether files are modified.\",\"weight\":95},{\"command\":\"git diff --stat\",\"reason\":\"Duplicate with lower weight.\",\"weight\":20}]}"}}]}`)
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

	if len(response.Suggestions) != 5 {
		t.Fatalf("expected exactly 5 suggestions, got %d", len(response.Suggestions))
	}
	if response.Suggestions[0].Command != "git status --short" || response.Suggestions[0].Weight != 95 {
		t.Fatalf("unexpected top suggestion: %+v", response.Suggestions[0])
	}
	if response.Suggestions[1].Command != "git diff --stat" || response.Suggestions[1].Weight != 82 {
		t.Fatalf("unexpected second suggestion: %+v", response.Suggestions[1])
	}
	if response.Suggestions[4].Weight <= 0 {
		t.Fatalf("expected fallback suggestion to include positive weight, got %+v", response.Suggestions[4])
	}
}

func TestCreateSuggestionsPreservesWhitespaceAcrossStreamChunks(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"for dir"}}]}`)
		writeSSEData(t, w, `{"choices":[{"delta":{"content":" in */; do"}}]}`)
		writeSSEData(t, w, `{"choices":[{"delta":{"content":" (cd \\\"$dir\\\""}}]}`)
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"&& git pull); done\",\"reason\":\"Batch update repos.\"}]}"}}]}`)
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

	response, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{})
	if err != nil {
		t.Fatalf("CreateSuggestions returned error: %v", err)
	}

	want := `for dir in */; do (cd "$dir"&& git pull); done`
	if response.Suggestions[0].Command != want {
		t.Fatalf("expected command %q, got %q", want, response.Suggestions[0].Command)
	}
}

func TestExtractOptionalModelContentPreservesWhitespaceInArrayContentParts(t *testing.T) {
	raw := json.RawMessage(`[{"type":"text","text":"echo"},{"type":"text","text":" "},{"type":"text","text":"hello"},{"type":"text","text":" "},{"type":"text","text":"world"}]`)

	content, ok, err := extractOptionalModelContent(raw)
	if err != nil {
		t.Fatalf("extractOptionalModelContent returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected content to be recognized")
	}

	want := "echo hello world"
	if content != want {
		t.Fatalf("expected content %q, got %q", want, content)
	}
}

func TestCreateSuggestionsIgnoresMetadataChunkWithoutChoices(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"id":"chunk-1","object":"chat.completion.chunk","choices":[]}`)
		writeSSEData(t, w, `{"choices":[{"delta":{"content":"{\"suggestions\":[{\"command\":\"pwd\",\"reason\":\"Confirm current directory.\"},{\"command\":\"ls -la\",\"reason\":\"List files.\"},{\"command\":\"npm test\",\"reason\":\"Run tests.\"},{\"command\":\"git status --short\",\"reason\":\"Check repo state.\"},{\"command\":\"go test ./...\",\"reason\":\"Run Go tests.\"}]}"}}]}`)
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
	if !strings.Contains(util.ErrorMessage(err, ""), "stream payload is invalid: not-json") {
		t.Fatalf("expected invalid payload error, got %v", err)
	}
}

func TestCreateSuggestionsReturnsBadGatewayWhenResponseIsNotSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"suggestions\":[]}"}}]}`))
	}))
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
	if !strings.Contains(util.ErrorMessage(err, ""), "did not return SSE") {
		t.Fatalf("expected non-SSE error, got %v", err)
	}
}

func TestCreateSuggestionsReturnsBadGatewayWhenStreamHasNoChoiceChunks(t *testing.T) {
	server := newAssistStreamServer(t, func(w http.ResponseWriter, _ *http.Request) {
		writeSSEData(t, w, `{"id":"chunk-1","object":"chat.completion.chunk","choices":[]}`)
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
	if !strings.Contains(util.ErrorMessage(err, ""), "stream returned no choice chunks") {
		t.Fatalf("expected no choice chunks error, got %v", err)
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

func TestCreateSuggestionsReturnsBadGatewayWhenStreamReadFails(t *testing.T) {
	svc := newTestService(config.AssistConfig{
		Enabled:            true,
		BaseURL:            "https://example.com/v1",
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
	svc.client = &http.Client{
		Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body: &errReadCloser{
					reader: &failingReader{
						parts: []string{"data: "},
						err:   errors.New("boom"),
					},
				},
			}, nil
		}),
	}

	_, err := svc.CreateSuggestions("s1", model.CreateAssistSuggestionsRequest{})
	if util.ErrorStatus(err) != http.StatusBadGateway {
		t.Fatalf("expected bad gateway error, got %d (%v)", util.ErrorStatus(err), err)
	}
	if !strings.Contains(util.ErrorMessage(err, ""), "assist model stream read failed:") {
		t.Fatalf("expected stream read error with cause, got %v", err)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

type errReadCloser struct {
	reader io.Reader
}

func (r *errReadCloser) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *errReadCloser) Close() error {
	return nil
}

type failingReader struct {
	parts []string
	index int
	err   error
}

func (r *failingReader) Read(p []byte) (int, error) {
	if r.index < len(r.parts) {
		part := r.parts[r.index]
		r.index++
		return copy(p, part), nil
	}
	return 0, r.err
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
	if !strings.Contains(logOutput, `request_body={"model":"gpt-test"`) {
		t.Fatalf("expected request body log, got %q", logOutput)
	}
	if !strings.Contains(logOutput, `"enable_thinking":false`) {
		t.Fatalf("expected enable_thinking in request body log, got %q", logOutput)
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
			baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			want:    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
		},
		{
			name:    "already full endpoint",
			baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
			want:    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
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
	if !strings.Contains(strings.ToLower(systemContent), "weight") {
		t.Fatalf("expected weight constraint in system prompt, got %q", systemContent)
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
