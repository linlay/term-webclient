package assist

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/util"
	"term-webclient-go/backend/internal/util/httpstream"
)

const defaultSystemPrompt = "You are an assistant for a terminal web client. Use the recent terminal or console text and the optional user question to infer the best next shell commands. Return strict JSON with a top-level object containing a suggestions array of exactly 3 items. Each suggestion must contain command, reason, and weight. weight must be an integer from 0 to 100, and suggestions must be ordered from highest weight to lowest weight. Every command must be a single-line plain shell command only, without markdown fences, numbering, or explanation text in the command field. reason must be simplified Chinese, very short, and suitable for one-line display."
const forcedJSONSystemPrompt = "Return valid JSON only. The final answer must be a json object with a top-level suggestions array. Every suggestion object must include command, reason, and weight. Do not include markdown, code fences, or any non-JSON text."
const assistSuggestionTargetCount = 3

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
	Suggestions []assistModelSuggestion `json:"suggestions"`
}

type assistModelSuggestion struct {
	Command string   `json:"command"`
	Reason  string   `json:"reason"`
	Weight  *float64 `json:"weight"`
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
	builder.WriteString("Recent terminal/console text (last 500 chars max):\n")
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
		message := httpstream.ExtractErrorMessage(response.StatusCode, body)
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), message, string(body))
		return "", util.NewStatusError(http.StatusBadGateway, "assist model request failed: "+message, nil)
	}
	if !isSSEContentType(contentType) {
		body, err := readResponseSnippet(response.Body)
		if err != nil {
			s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), "read non-SSE response body failed", "")
			return "", util.NewStatusError(http.StatusBadGateway, "assist model stream response is invalid", err)
		}
		message := fmt.Sprintf("assist model did not return SSE (content-type: %s)", util.FallbackString(contentType, "(empty)"))
		s.logFailure(sessionID, response.StatusCode, time.Since(startedAt), message, string(body))
		return "", util.NewStatusError(http.StatusBadGateway, message, nil)
	}

	s.logDebug(sessionID, "stream started")

	var builder strings.Builder
	eventCount := 0
	done := false
	choiceChunkCount := 0
	if err := httpstream.ReadSSEEvents(response.Body, func(payload string) error {
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
		var statusErr *util.StatusError
		if !errors.As(err, &statusErr) {
			err = util.NewStatusError(http.StatusBadGateway, "assist model stream read failed: "+err.Error(), err)
		}
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

func normalizeSuggestions(raw []assistModelSuggestion) []model.AssistSuggestionItem {
	seen := map[string]int{}
	result := make([]model.AssistSuggestionItem, 0, len(raw))
	for index, item := range raw {
		command := strings.TrimSpace(item.Command)
		reason := strings.TrimSpace(item.Reason)
		if command == "" || reason == "" {
			continue
		}
		key := strings.ToLower(command)
		normalized := model.AssistSuggestionItem{
			ID:      suggestionID(command),
			Command: command,
			Reason:  reason,
			Weight:  normalizeSuggestionWeight(item.Weight, index),
		}
		if existingIndex, ok := seen[key]; ok {
			if normalized.Weight > result[existingIndex].Weight {
				result[existingIndex] = normalized
			}
			continue
		}
		seen[key] = len(result)
		result = append(result, normalized)
	}
	sortSuggestions(result)
	return result
}

func padSuggestions(suggestions []model.AssistSuggestionItem) []model.AssistSuggestionItem {
	fallbacks := []model.AssistSuggestionItem{
		{ID: suggestionID("pwd"), Command: "pwd", Reason: "确认当前目录", Weight: 60},
		{ID: suggestionID("ls -la"), Command: "ls -la", Reason: "查看文件列表", Weight: 55},
		{ID: suggestionID("git status --short"), Command: "git status --short", Reason: "检查仓库改动", Weight: 50},
		{ID: suggestionID("npm test"), Command: "npm test", Reason: "运行默认测试", Weight: 45},
		{ID: suggestionID("go test ./..."), Command: "go test ./...", Reason: "运行 Go 测试", Weight: 40},
	}
	seen := map[string]struct{}{}
	for _, item := range suggestions {
		seen[strings.ToLower(item.Command)] = struct{}{}
	}
	result := append([]model.AssistSuggestionItem(nil), suggestions...)
	for _, fallback := range fallbacks {
		if len(result) >= assistSuggestionTargetCount {
			break
		}
		if _, ok := seen[strings.ToLower(fallback.Command)]; ok {
			continue
		}
		seen[strings.ToLower(fallback.Command)] = struct{}{}
		result = append(result, fallback)
	}
	sortSuggestions(result)
	if len(result) > assistSuggestionTargetCount {
		return result[:assistSuggestionTargetCount]
	}
	return result
}

func normalizeSuggestionWeight(weight *float64, index int) int {
	if weight == nil {
		inferred := 100 - index*5
		if inferred < 1 {
			return 1
		}
		return inferred
	}
	value := int(*weight + 0.5)
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func sortSuggestions(items []model.AssistSuggestionItem) {
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].Weight > items[j].Weight
	})
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
