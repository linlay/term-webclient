package assist

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
)

const defaultSystemPrompt = "You are an assistant for a terminal web client. Return strict JSON with a top-level object containing a suggestions array. Each suggestion must contain command and reason. Produce at least 5 concise, actionable terminal next-step suggestions based on the recent screen text and optional user question. Commands must be plain shell commands only, without markdown fences, numbering, or explanation text in the command field."
const forcedJSONSystemPrompt = "Return valid JSON only. The final answer must be a json object with a top-level suggestions array. Do not include markdown, code fences, or any non-JSON text."

type screenTextProvider interface {
	GetScreenText(sessionID string) (model.ScreenTextResponse, error)
}

type Service struct {
	cfg      config.AssistConfig
	sessions screenTextProvider
	client   *http.Client
	logf     func(format string, args ...any)
}

type openAIChatCompletionsRequest struct {
	Model          string                `json:"model"`
	Messages       []openAIChatMessage   `json:"messages"`
	ResponseFormat *openAIResponseFormat `json:"response_format,omitempty"`
	Stream         bool                  `json:"stream,omitempty"`
	EnableThinking *bool                 `json:"enable_thinking,omitempty"`
}

type openAIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIResponseFormat struct {
	Type string `json:"type"`
}

type openAIErrorResponse struct {
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type openAIChatCompletionsStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content json.RawMessage `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason,omitempty"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type assistModelResponse struct {
	Suggestions []struct {
		Command string `json:"command"`
		Reason  string `json:"reason"`
	} `json:"suggestions"`
}

func New(cfg *config.Config, sessions screenTextProvider) *Service {
	timeout := time.Duration(cfg.Assist.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &Service{
		cfg:      cfg.Assist,
		sessions: sessions,
		client:   &http.Client{Timeout: timeout},
		logf:     log.Printf,
	}
}

func (s *Service) CreateSuggestions(sessionID string, request model.CreateAssistSuggestionsRequest) (model.AssistSuggestionsResponse, error) {
	if !s.cfg.Enabled {
		return model.AssistSuggestionsResponse{}, util.NewStatusError(http.StatusBadRequest, "assist is disabled", nil)
	}
	if strings.TrimSpace(s.cfg.BaseURL) == "" || strings.TrimSpace(s.cfg.APIKey) == "" || strings.TrimSpace(s.cfg.Model) == "" {
		return model.AssistSuggestionsResponse{}, util.NewStatusError(http.StatusInternalServerError, "assist configuration is incomplete", nil)
	}

	screen, err := s.sessions.GetScreenText(sessionID)
	if err != nil {
		return model.AssistSuggestionsResponse{}, err
	}

	captured := truncateRecentChars(screen.Text, s.cfg.MaxScreenTextChars)
	question := strings.TrimSpace(request.Question)
	if captured == "" && question == "" {
		return model.AssistSuggestionsResponse{}, util.NewStatusError(http.StatusBadRequest, "question or recent screen text is required", nil)
	}

	suggestions, err := s.requestModel(sessionID, question, captured)
	if err != nil {
		return model.AssistSuggestionsResponse{}, err
	}

	return model.AssistSuggestionsResponse{
		CapturedScreenText: captured,
		CapturedChars:      utf8.RuneCountInString(captured),
		Suggestions:        suggestions,
	}, nil
}

func (s *Service) requestModel(sessionID, question, capturedScreenText string) ([]model.AssistSuggestionItem, error) {
	messages := buildMessages(s.cfg.SystemPrompt, question, capturedScreenText)
	payload := openAIChatCompletionsRequest{
		Model:          s.cfg.Model,
		Messages:       messages,
		ResponseFormat: &openAIResponseFormat{Type: "json_object"},
		Stream:         true,
		EnableThinking: boolPtr(false),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, util.NewStatusError(http.StatusInternalServerError, "marshal assist request failed", err)
	}

	endpoint := resolveChatCompletionsEndpoint(s.cfg.BaseURL)
	httpRequest, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, util.NewStatusError(http.StatusInternalServerError, "create assist request failed", err)
	}
	httpRequest.Header.Set("content-type", "application/json")
	httpRequest.Header.Set("accept", "text/event-stream")
	httpRequest.Header.Set("authorization", "Bearer "+s.cfg.APIKey)

	s.logRequest(sessionID, http.MethodPost, endpoint, body, payload, httpRequest.Header)
	startedAt := time.Now()
	response, err := s.client.Do(httpRequest)
	if err != nil {
		s.logFailure(sessionID, 0, time.Since(startedAt), err.Error(), "")
		return nil, util.NewStatusError(http.StatusBadGateway, "assist model request failed", err)
	}
	defer response.Body.Close()

	content, err := s.collectStreamContent(sessionID, response, startedAt)
	if err != nil {
		return nil, err
	}

	var parsed assistModelResponse
	if err := json.Unmarshal([]byte(stripCodeFences(content)), &parsed); err != nil {
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), "assist model returned invalid JSON", content)
		return nil, util.NewStatusError(http.StatusBadGateway, "assist model returned invalid JSON", err)
	}

	suggestions := normalizeSuggestions(parsed.Suggestions)
	if len(suggestions) == 0 {
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), "assist model returned no usable suggestions", content)
		return nil, util.NewStatusError(http.StatusBadGateway, "assist model returned no usable suggestions", nil)
	}
	return padSuggestions(suggestions), nil
}

func buildMessages(customSystemPrompt, question, capturedScreenText string) []openAIChatMessage {
	return []openAIChatMessage{
		{
			Role:    "system",
			Content: buildSystemPrompt(customSystemPrompt),
		},
		{
			Role:    "user",
			Content: buildUserPrompt(question, capturedScreenText),
		},
	}
}

func buildSystemPrompt(customSystemPrompt string) string {
	parts := make([]string, 0, 3)
	if trimmed := strings.TrimSpace(customSystemPrompt); trimmed != "" {
		parts = append(parts, trimmed)
	}
	parts = append(parts, defaultSystemPrompt, forcedJSONSystemPrompt)
	return strings.Join(parts, "\n\n")
}

func buildUserPrompt(question, capturedScreenText string) string {
	var builder strings.Builder
	builder.WriteString("Recent screen text (last 500 chars max):\n")
	if strings.TrimSpace(capturedScreenText) == "" {
		builder.WriteString("(empty)\n")
	} else {
		builder.WriteString(capturedScreenText)
		builder.WriteString("\n")
	}
	builder.WriteString("\n")
	builder.WriteString("Optional user question:\n")
	if strings.TrimSpace(question) == "" {
		builder.WriteString("(none)")
	} else {
		builder.WriteString(question)
	}
	return builder.String()
}

func truncateRecentChars(value string, maxChars int) string {
	if maxChars <= 0 {
		maxChars = 500
	}
	runes := []rune(value)
	if len(runes) <= maxChars {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(string(runes[len(runes)-maxChars:]))
}

func resolveChatCompletionsEndpoint(baseURL string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(trimmed, "/chat/completions") {
		return trimmed
	}
	return trimmed + "/chat/completions"
}

func extractModelContent(raw json.RawMessage) (string, error) {
	content, ok, err := extractOptionalModelContent(raw)
	if err != nil {
		return "", err
	}
	if ok {
		return content, nil
	}
	return "", fmt.Errorf("unsupported content shape")
}

func extractOptionalModelContent(raw json.RawMessage) (string, bool, error) {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", true, nil
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return asString, true, nil
	}

	var asParts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &asParts); err == nil {
		var builder strings.Builder
		for _, part := range asParts {
			if part.Text == "" {
				continue
			}
			builder.WriteString(part.Text)
		}
		return builder.String(), true, nil
	}

	return "", false, nil
}

func (s *Service) collectStreamContent(sessionID string, response *http.Response, startedAt time.Time) (string, error) {
	contentType := strings.TrimSpace(response.Header.Get("content-type"))
	s.logDebug(sessionID, "response status=%d status_text=%q content_type=%q headers=%v", response.StatusCode, response.Status, contentType, flattenHeaders(response.Header))

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, err := readResponseSnippet(response.Body)
		if err != nil {
			s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), "read error response body failed", "")
			return "", util.NewStatusError(http.StatusBadGateway, "assist model response is invalid", err)
		}
		message := extractErrorMessage(response.Status, body)
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), message, string(body))
		return "", util.NewStatusError(http.StatusBadGateway, "assist model request failed: "+message, nil)
	}
	if !isSSEContentType(contentType) {
		body, err := readResponseSnippet(response.Body)
		if err != nil {
			s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), "read non-SSE response body failed", "")
			return "", util.NewStatusError(http.StatusBadGateway, "assist model stream response is invalid", err)
		}
		message := fmt.Sprintf("assist model did not return SSE (content-type: %s)", fallbackString(contentType, "(empty)"))
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), message, string(body))
		return "", util.NewStatusError(http.StatusBadGateway, message, nil)
	}

	s.logDebug(sessionID, "stream started")

	var builder strings.Builder
	eventCount := 0
	done := false
	choiceChunkCount := 0
	if err := readSSEDataEvents(response.Body, func(payload string) error {
		trimmed := strings.TrimSpace(payload)
		if trimmed == "" {
			return nil
		}
		eventCount++
		s.logDebug(sessionID, "stream event[%d]=%q", eventCount, truncateForLog(trimmed, 1024))
		if trimmed == "[DONE]" {
			done = true
			return nil
		}
		delta, hasChoices, err := extractStreamDelta(trimmed)
		if err != nil {
			return err
		}
		if !hasChoices {
			s.logDebug(sessionID, "stream event[%d] ignored: no choices", eventCount)
			return nil
		}
		choiceChunkCount++
		builder.WriteString(delta)
		return nil
	}); err != nil {
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), util.ErrorMessage(err, "assist model stream failed"), "")
		return "", err
	}
	if !done {
		err := util.NewStatusError(http.StatusBadGateway, "assist model stream ended before completion", nil)
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), util.ErrorMessage(err, "assist model stream ended before completion"), "")
		return "", err
	}

	content := strings.TrimSpace(builder.String())
	if choiceChunkCount == 0 {
		err := util.NewStatusError(http.StatusBadGateway, "assist model stream returned no choice chunks", nil)
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), util.ErrorMessage(err, "assist model stream returned no choice chunks"), content)
		return "", err
	}
	s.logDebug(sessionID, "stream completed status=%d duration_ms=%d events=%d content_chars=%d", response.StatusCode, time.Since(startedAt).Milliseconds(), eventCount, utf8.RuneCountInString(content))
	s.logDebug(sessionID, "response content=%q", content)
	return content, nil
}

func readSSEDataEvents(reader io.Reader, onEvent func(payload string) error) error {
	buffered := bufio.NewReader(reader)
	dataLines := make([]string, 0, 2)

	flush := func() error {
		if len(dataLines) == 0 {
			return nil
		}
		payload := strings.Join(dataLines, "\n")
		dataLines = dataLines[:0]
		return onEvent(payload)
	}

	for {
		line, err := buffered.ReadString('\n')
		if err != nil && err != io.EOF {
			return util.NewStatusError(http.StatusBadGateway, "assist model stream read failed: "+err.Error(), err)
		}

		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if flushErr := flush(); flushErr != nil {
				return flushErr
			}
		} else if strings.HasPrefix(line, "data:") {
			payload := strings.TrimPrefix(line, "data:")
			payload = strings.TrimPrefix(payload, " ")
			dataLines = append(dataLines, payload)
		}

		if err == io.EOF {
			if flushErr := flush(); flushErr != nil {
				return flushErr
			}
			return nil
		}
	}
}

func extractStreamDelta(payload string) (string, bool, error) {
	var chunk openAIChatCompletionsStreamChunk
	if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
		return "", false, util.NewStatusError(http.StatusBadGateway, "assist model stream payload is invalid: "+truncateForLog(payload, 512), err)
	}
	if chunk.Error != nil && strings.TrimSpace(chunk.Error.Message) != "" {
		return "", false, util.NewStatusError(http.StatusBadGateway, "assist model request failed: "+strings.TrimSpace(chunk.Error.Message), nil)
	}
	if len(chunk.Choices) == 0 {
		return "", false, nil
	}

	var builder strings.Builder
	for _, choice := range chunk.Choices {
		content, ok, err := extractOptionalModelContent(choice.Delta.Content)
		if err != nil {
			return "", false, util.NewStatusError(http.StatusBadGateway, "assist model stream content is invalid", err)
		}
		if !ok {
			return "", false, util.NewStatusError(http.StatusBadGateway, "assist model stream content is invalid", fmt.Errorf("unsupported content shape"))
		}
		builder.WriteString(content)
	}
	return builder.String(), true, nil
}

func extractErrorMessage(status string, body []byte) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return status
	}

	var decoded openAIErrorResponse
	if err := json.Unmarshal(trimmed, &decoded); err == nil && decoded.Error != nil && strings.TrimSpace(decoded.Error.Message) != "" {
		return strings.TrimSpace(decoded.Error.Message)
	}

	return string(trimmed)
}

func (s *Service) logRequest(sessionID, method, endpoint string, body []byte, payload openAIChatCompletionsRequest, headers http.Header) {
	s.logDebug(sessionID, "request method=%s model=%s endpoint=%s timeout=%s stream=%t response_format=%s enable_thinking=%v", method, payload.Model, endpoint, s.client.Timeout, payload.Stream, responseFormatType(payload.ResponseFormat), boolValue(payload.EnableThinking))
	for index, message := range payload.Messages {
		s.logDebug(sessionID, "message[%d] role=%s content=%q", index, message.Role, message.Content)
	}
	s.logDebug(sessionID, "headers=%v", redactHeaders(headers))
	s.logDebug(sessionID, "request_body=%s", string(body))
}

func (s *Service) logFailure(sessionID string, statusCode int, duration time.Duration, message, responseBody string) {
	if !s.cfg.DebugLog {
		return
	}
	s.logDebug(sessionID, "failure status=%d duration_ms=%d message=%q", statusCode, duration.Milliseconds(), message)
	if strings.TrimSpace(responseBody) != "" {
		s.logDebug(sessionID, "failure body=%q", responseBody)
	}
}

func (s *Service) logDebug(sessionID, format string, args ...any) {
	if !s.cfg.DebugLog || s.logf == nil {
		return
	}
	values := append([]any{sessionID}, args...)
	s.logf("assist debug session=%s "+format, values...)
}

func redactHeaders(headers http.Header) map[string]string {
	result := make(map[string]string, len(headers))
	for key, values := range headers {
		if len(values) == 0 {
			result[key] = ""
			continue
		}
		if strings.EqualFold(key, "authorization") {
			result[key] = redactAuthorization(values[0])
			continue
		}
		result[key] = strings.Join(values, ", ")
	}
	return result
}

func redactAuthorization(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	parts := strings.SplitN(trimmed, " ", 2)
	if len(parts) == 2 && strings.TrimSpace(parts[0]) != "" {
		return parts[0] + " ***"
	}
	return "***"
}

func responseFormatType(format *openAIResponseFormat) string {
	if format == nil {
		return ""
	}
	return format.Type
}

func flattenHeaders(headers http.Header) map[string]string {
	result := make(map[string]string, len(headers))
	for key, values := range headers {
		result[key] = strings.Join(values, ", ")
	}
	return result
}

func isSSEContentType(contentType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "text/event-stream")
}

func readResponseSnippet(reader io.Reader) ([]byte, error) {
	return io.ReadAll(io.LimitReader(reader, 4096))
}

func truncateForLog(value string, max int) string {
	trimmed := strings.TrimSpace(value)
	if max <= 0 || len(trimmed) <= max {
		return trimmed
	}
	return trimmed[:max] + "...(truncated)"
}

func boolPtr(value bool) *bool {
	return &value
}

func boolValue(value *bool) any {
	if value == nil {
		return nil
	}
	return *value
}

func stripCodeFences(value string) string {
	trimmed := strings.TrimSpace(value)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	return strings.TrimSpace(trimmed)
}

func normalizeSuggestions(raw []struct {
	Command string `json:"command"`
	Reason  string `json:"reason"`
}) []model.AssistSuggestionItem {
	seen := map[string]struct{}{}
	result := make([]model.AssistSuggestionItem, 0, len(raw))
	for _, item := range raw {
		command := strings.TrimSpace(item.Command)
		reason := strings.TrimSpace(item.Reason)
		if command == "" || reason == "" {
			continue
		}
		key := strings.ToLower(command)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, model.AssistSuggestionItem{
			ID:      suggestionID(command),
			Command: command,
			Reason:  reason,
		})
	}
	return result
}

func padSuggestions(suggestions []model.AssistSuggestionItem) []model.AssistSuggestionItem {
	fallbacks := []model.AssistSuggestionItem{
		{ID: suggestionID("pwd"), Command: "pwd", Reason: "Confirm the current working directory before taking the next step."},
		{ID: suggestionID("ls -la"), Command: "ls -la", Reason: "Inspect the current directory and file metadata."},
		{ID: suggestionID("git status --short"), Command: "git status --short", Reason: "Check whether the workspace has pending repository changes."},
		{ID: suggestionID("npm test"), Command: "npm test", Reason: "Run the default frontend or Node test command when relevant."},
		{ID: suggestionID("go test ./..."), Command: "go test ./...", Reason: "Run the Go test suite when the workspace is a Go project."},
	}
	seen := map[string]struct{}{}
	for _, item := range suggestions {
		seen[strings.ToLower(item.Command)] = struct{}{}
	}
	result := append([]model.AssistSuggestionItem(nil), suggestions...)
	for _, fallback := range fallbacks {
		if len(result) >= 5 {
			break
		}
		if _, ok := seen[strings.ToLower(fallback.Command)]; ok {
			continue
		}
		seen[strings.ToLower(fallback.Command)] = struct{}{}
		result = append(result, fallback)
	}
	if len(result) > 8 {
		return result[:8]
	}
	return result
}

func suggestionID(command string) string {
	normalized := strings.ToLower(strings.TrimSpace(command))
	var builder strings.Builder
	lastDash := false
	for _, ch := range normalized {
		isAlphaNum := (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
		if isAlphaNum {
			builder.WriteRune(ch)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteRune('-')
			lastDash = true
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "suggestion"
	}
	return result
}

func fallbackString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
