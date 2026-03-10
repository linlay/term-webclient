package copilot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/session"
	"term-webclient-go/backend/internal/util"
)

const (
	defaultCommandPollInterval   = 120 * time.Millisecond
	maxCommandOutputExcerptRunes = 4000
)

type sessionAccessor interface {
	Exists(sessionID string) bool
	GetRequiredSession(sessionID string) (*session.Session, error)
	WriteInputFromAgent(sessionID, data string) error
	GetSnapshot(sessionID string, afterSeq int64) (model.SessionSnapshotResponse, error)
}

type Service struct {
	cfg      *config.Config
	sessions sessionAccessor
	client   *http.Client

	lockMu          sync.Mutex
	commandLockByID map[string]*sync.Mutex
}

type runnerEnvelope struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

func New(cfg *config.Config, sessions sessionAccessor) *Service {
	timeout := time.Duration(cfg.Copilot.Runner.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return &Service{
		cfg:             cfg,
		sessions:        sessions,
		client:          &http.Client{Timeout: timeout},
		commandLockByID: map[string]*sync.Mutex{},
	}
}

func (s *Service) ListAgents(sessionID string) ([]model.CopilotAgentResponse, error) {
	if !s.sessions.Exists(sessionID) {
		return nil, util.NewStatusError(http.StatusBadRequest, "Session not found: "+sessionID, nil)
	}
	result := make([]model.CopilotAgentResponse, 0, len(s.cfg.Copilot.Agents))
	for _, item := range s.cfg.Copilot.Agents {
		agentType := model.CopilotAgentType(item.Type)
		response := model.CopilotAgentResponse{
			Key:         item.Key,
			Label:       item.Label,
			Description: item.Description,
			Type:        agentType,
			Default:     item.Default,
		}
		if strings.TrimSpace(item.Icon.Name) != "" || strings.TrimSpace(item.Icon.Color) != "" {
			response.Icon = &model.CopilotAgentIcon{
				Name:  item.Icon.Name,
				Color: item.Icon.Color,
			}
		}
		result = append(result, response)
	}
	return result, nil
}

func (s *Service) ListChats(sessionID, configuredAgentKey, lastRunID, authHeader string) ([]model.CopilotChatSummaryResponse, error) {
	if !s.sessions.Exists(sessionID) {
		return nil, util.NewStatusError(http.StatusBadRequest, "Session not found: "+sessionID, nil)
	}
	agentCfg, err := s.requireRunnerAgent(configuredAgentKey)
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	query.Set("agentKey", agentCfg.Key)
	if strings.TrimSpace(lastRunID) != "" {
		query.Set("lastRunId", strings.TrimSpace(lastRunID))
	}

	var response []model.CopilotChatSummaryResponse
	if err := s.doJSON(http.MethodGet, "/chats", query, nil, authHeader, &response); err != nil {
		return nil, err
	}
	return response, nil
}

func (s *Service) GetChat(sessionID, chatID, authHeader string) (model.CopilotChatDetailResponse, error) {
	if !s.sessions.Exists(sessionID) {
		return model.CopilotChatDetailResponse{}, util.NewStatusError(http.StatusBadRequest, "Session not found: "+sessionID, nil)
	}
	query := url.Values{}
	query.Set("chatId", strings.TrimSpace(chatID))
	var response model.CopilotChatDetailResponse
	if err := s.doJSON(http.MethodGet, "/chat", query, nil, authHeader, &response); err != nil {
		return model.CopilotChatDetailResponse{}, err
	}
	return response, nil
}

func (s *Service) Submit(sessionID string, request model.CopilotSubmitRequest, authHeader string) (model.CopilotSubmitResponse, error) {
	if !s.sessions.Exists(sessionID) {
		return model.CopilotSubmitResponse{}, util.NewStatusError(http.StatusBadRequest, "Session not found: "+sessionID, nil)
	}
	if strings.TrimSpace(request.RunID) == "" {
		return model.CopilotSubmitResponse{}, util.NewStatusError(http.StatusBadRequest, "runId is required", nil)
	}
	if strings.TrimSpace(request.ToolID) == "" {
		return model.CopilotSubmitResponse{}, util.NewStatusError(http.StatusBadRequest, "toolId is required", nil)
	}

	payload := map[string]any{
		"runId":  strings.TrimSpace(request.RunID),
		"toolId": strings.TrimSpace(request.ToolID),
		"params": request.Params,
	}
	var response model.CopilotSubmitResponse
	if err := s.doJSON(http.MethodPost, "/submit", nil, payload, authHeader, &response); err != nil {
		return model.CopilotSubmitResponse{}, err
	}
	return response, nil
}

func (s *Service) ProxyQuery(ctx context.Context, w http.ResponseWriter, sessionID string, request model.CopilotQueryRequest, authHeader string) error {
	if !s.sessions.Exists(sessionID) {
		return util.NewStatusError(http.StatusBadRequest, "Session not found: "+sessionID, nil)
	}
	if _, err := s.requireRunnableSession(sessionID); err != nil {
		return err
	}
	agentCfg, err := s.requireRunnerAgent(request.AgentKey)
	if err != nil {
		return err
	}
	if strings.TrimSpace(request.Message) == "" {
		return util.NewStatusError(http.StatusBadRequest, "message is required", nil)
	}

	payload := map[string]any{
		"agentKey": agentCfg.Key,
		"message":  strings.TrimSpace(request.Message),
		"stream":   true,
	}
	if strings.TrimSpace(request.RequestID) != "" {
		payload["requestId"] = strings.TrimSpace(request.RequestID)
	}
	if strings.TrimSpace(request.ChatID) != "" {
		payload["chatId"] = strings.TrimSpace(request.ChatID)
	}
	if strings.TrimSpace(request.Role) != "" {
		payload["role"] = strings.TrimSpace(request.Role)
	}
	if len(request.References) > 0 {
		payload["references"] = request.References
	}
	if len(request.Params) > 0 {
		payload["params"] = request.Params
	}
	if len(request.Scene) > 0 {
		payload["scene"] = request.Scene
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return util.NewStatusError(http.StatusInternalServerError, "marshal runner query failed", err)
	}

	endpoint, err := s.resolveRunnerURL("/query", nil)
	if err != nil {
		return err
	}
	upstreamReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return util.NewStatusError(http.StatusInternalServerError, "create runner query request failed", err)
	}
	upstreamReq.Header.Set("content-type", "application/json")
	upstreamReq.Header.Set("accept", "text/event-stream")
	if resolved := s.resolveAuthorizationHeader(authHeader); resolved != "" {
		upstreamReq.Header.Set("authorization", resolved)
	}

	response, err := s.client.Do(upstreamReq)
	if err != nil {
		return util.NewStatusError(http.StatusBadGateway, "runner query request failed", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(response.Body)
		message := runnerErrorMessage(response.StatusCode, payload)
		return util.NewStatusError(http.StatusBadGateway, message, nil)
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	flusher, ok := w.(http.Flusher)
	if !ok {
		_, _ = io.Copy(w, response.Body)
		return nil
	}

	buffer := make([]byte, 2048)
	for {
		read, readErr := response.Body.Read(buffer)
		if read > 0 {
			if _, err := w.Write(buffer[:read]); err != nil {
				return util.NewStatusError(http.StatusBadGateway, "write runner query stream failed", err)
			}
			flusher.Flush()
		}
		if readErr == nil {
			continue
		}
		if readErr == io.EOF {
			return nil
		}
		return util.NewStatusError(http.StatusBadGateway, "read runner query stream failed", readErr)
	}
}

func (s *Service) ExecuteCommand(sessionID string, request model.CopilotExecuteCommandRequest) (model.CopilotExecuteCommandResponse, error) {
	command := strings.TrimSpace(request.Command)
	if command == "" {
		return model.CopilotExecuteCommandResponse{}, util.NewStatusError(http.StatusBadRequest, "command is required", nil)
	}
	if _, err := s.requireRunnableSession(sessionID); err != nil {
		return model.CopilotExecuteCommandResponse{}, err
	}

	lock := s.commandLock(sessionID)
	lock.Lock()
	defer lock.Unlock()

	activeSession, err := s.sessions.GetRequiredSession(sessionID)
	if err != nil {
		return model.CopilotExecuteCommandResponse{}, err
	}
	beforeSeq := activeSession.NextSeq.Load()
	marker := "__TWC_COPILOT_EXIT_" + util.NewID() + "__"
	wrappedCommand := buildWrappedCommand(command, marker)
	startedAt := time.Now().UTC()
	if err := s.sessions.WriteInputFromAgent(sessionID, wrappedCommand); err != nil {
		return model.CopilotExecuteCommandResponse{}, err
	}

	timeout := time.Duration(s.cfg.Terminal.Agent.StepTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	if request.TimeoutSeconds != nil && *request.TimeoutSeconds > 0 {
		timeout = time.Duration(*request.TimeoutSeconds) * time.Second
	}

	transcript, exitCode, completedAt, err := s.waitForCommandResult(sessionID, beforeSeq, marker, timeout)
	if err != nil {
		return model.CopilotExecuteCommandResponse{}, err
	}
	return model.CopilotExecuteCommandResponse{
		SessionID:       sessionID,
		Command:         command,
		ExitCode:        exitCode,
		TranscriptDelta: transcript,
		OutputExcerpt:   tailRunes(transcript, maxCommandOutputExcerptRunes),
		StartedAt:       startedAt,
		CompletedAt:     completedAt,
	}, nil
}

func (s *Service) doJSON(method, path string, query url.Values, body any, authHeader string, target any) error {
	var requestBody io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return util.NewStatusError(http.StatusInternalServerError, "marshal runner request failed", err)
		}
		requestBody = bytes.NewReader(payload)
	}

	endpoint, err := s.resolveRunnerURL(path, query)
	if err != nil {
		return err
	}
	request, err := http.NewRequest(method, endpoint, requestBody)
	if err != nil {
		return util.NewStatusError(http.StatusInternalServerError, "create runner request failed", err)
	}
	request.Header.Set("accept", "application/json")
	if body != nil {
		request.Header.Set("content-type", "application/json")
	}
	if resolved := s.resolveAuthorizationHeader(authHeader); resolved != "" {
		request.Header.Set("authorization", resolved)
	}

	response, err := s.client.Do(request)
	if err != nil {
		return util.NewStatusError(http.StatusBadGateway, "runner request failed", err)
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return util.NewStatusError(http.StatusBadGateway, "read runner response failed", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return util.NewStatusError(http.StatusBadGateway, runnerErrorMessage(response.StatusCode, payload), nil)
	}

	var envelope runnerEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return util.NewStatusError(http.StatusBadGateway, "runner response is invalid", err)
	}
	if envelope.Code != 0 {
		message := strings.TrimSpace(envelope.Msg)
		if message == "" {
			message = "runner request failed"
		}
		return util.NewStatusError(http.StatusBadGateway, message, nil)
	}
	if target == nil {
		return nil
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return util.NewStatusError(http.StatusBadGateway, "runner response payload is invalid", err)
	}
	return nil
}

func (s *Service) resolveRunnerURL(path string, query url.Values) (string, error) {
	base := strings.TrimSpace(s.cfg.Copilot.Runner.BaseURL)
	if base == "" {
		return "", util.NewStatusError(http.StatusInternalServerError, "copilot runner base-url is not configured", nil)
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return "", util.NewStatusError(http.StatusInternalServerError, "copilot runner base-url is invalid", err)
	}
	basePath := strings.TrimRight(parsed.Path, "/")
	if !strings.HasSuffix(basePath, "/api/ap") {
		basePath += "/api/ap"
	}
	parsed.Path = basePath + "/" + strings.TrimLeft(path, "/")
	parsed.RawQuery = ""
	if query != nil {
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), nil
}

func (s *Service) resolveAuthorizationHeader(requestHeader string) string {
	if trimmed := strings.TrimSpace(requestHeader); trimmed != "" {
		return trimmed
	}
	fallback := strings.TrimSpace(s.cfg.Copilot.Runner.AuthorizationBearer)
	if fallback == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(fallback), "bearer ") {
		return fallback
	}
	return "Bearer " + fallback
}

func (s *Service) requireRunnerAgent(configuredAgentKey string) (*config.CopilotAgentConfig, error) {
	agentCfg, err := s.resolveAgent(configuredAgentKey)
	if err != nil {
		return nil, err
	}
	if agentCfg.Type != string(model.CopilotAgentTypeRunnerAgent) {
		return nil, util.NewStatusError(http.StatusBadRequest, "selected agent is not a runner agent", nil)
	}
	return agentCfg, nil
}

func (s *Service) resolveAgent(configuredAgentKey string) (*config.CopilotAgentConfig, error) {
	targetKey := strings.TrimSpace(configuredAgentKey)
	if targetKey == "" {
		for index := range s.cfg.Copilot.Agents {
			if s.cfg.Copilot.Agents[index].Default {
				return &s.cfg.Copilot.Agents[index], nil
			}
		}
		return nil, util.NewStatusError(http.StatusInternalServerError, "default copilot agent is not configured", nil)
	}
	for index := range s.cfg.Copilot.Agents {
		if s.cfg.Copilot.Agents[index].Key == targetKey {
			return &s.cfg.Copilot.Agents[index], nil
		}
	}
	return nil, util.NewStatusError(http.StatusBadRequest, "copilot agent not found: "+targetKey, nil)
}

func (s *Service) requireRunnableSession(sessionID string) (*session.Session, error) {
	activeSession, err := s.sessions.GetRequiredSession(sessionID)
	if err != nil {
		return nil, err
	}
	switch activeSession.SessionType {
	case model.SessionTypeSSHShell:
		return activeSession, nil
	case model.SessionTypeLocalPTY:
		switch normalizeToolID(activeSession.ToolID) {
		case "terminal", "ssh":
			return activeSession, nil
		default:
			return nil, util.NewStatusError(http.StatusBadRequest, "copilot runner agents require a shell or ssh terminal tab", nil)
		}
	default:
		return nil, util.NewStatusError(http.StatusBadRequest, "copilot runner agents require a shell or ssh terminal tab", nil)
	}
}

func (s *Service) commandLock(sessionID string) *sync.Mutex {
	s.lockMu.Lock()
	defer s.lockMu.Unlock()
	if lock, ok := s.commandLockByID[sessionID]; ok {
		return lock
	}
	lock := &sync.Mutex{}
	s.commandLockByID[sessionID] = lock
	return lock
}

func (s *Service) waitForCommandResult(sessionID string, afterSeq int64, marker string, timeout time.Duration) (string, int, time.Time, error) {
	deadline := time.Now().Add(timeout)
	lastSeq := afterSeq
	var transcript strings.Builder

	for time.Now().Before(deadline) {
		snapshot, err := s.sessions.GetSnapshot(sessionID, lastSeq)
		if err != nil {
			return "", 0, time.Time{}, err
		}
		for _, chunk := range snapshot.Chunks {
			if chunk.Seq > lastSeq {
				lastSeq = chunk.Seq
			}
			transcript.WriteString(chunk.Data)
		}
		text := transcript.String()
		if trimmed, exitCode, ok := extractCommandCompletion(text, marker); ok {
			return trimmed, exitCode, time.Now().UTC(), nil
		}
		time.Sleep(defaultCommandPollInterval)
	}

	return "", 0, time.Time{}, util.NewStatusError(
		http.StatusGatewayTimeout,
		"command execution timed out before completion marker was observed",
		nil,
	)
}

func buildWrappedCommand(command, marker string) string {
	var builder strings.Builder
	builder.WriteString("{ ")
	builder.WriteString(command)
	builder.WriteString("\n}\n")
	builder.WriteString("__TWC_COPILOT_STATUS=$?\n")
	builder.WriteString("printf '\\n")
	builder.WriteString(marker)
	builder.WriteString(":%s\\n' \"$__TWC_COPILOT_STATUS\"\n")
	return builder.String()
}

func extractCommandCompletion(transcript, marker string) (string, int, bool) {
	index := strings.LastIndex(transcript, marker+":")
	if index < 0 {
		return "", 0, false
	}

	line := transcript[index+len(marker)+1:]
	line = strings.TrimLeft(line, "\r\n")
	lineEnd := len(line)
	for idx, ch := range line {
		if ch == '\n' || ch == '\r' {
			lineEnd = idx
			break
		}
	}
	exitText := strings.TrimSpace(line[:lineEnd])
	if exitText == "" {
		return "", 0, false
	}
	exitCode, err := strconv.Atoi(exitText)
	if err != nil {
		return "", 0, false
	}

	trimmed := transcript[:index]
	trimmed = strings.TrimRight(trimmed, "\r\n")
	return trimmed, exitCode, true
}

func runnerErrorMessage(status int, payload []byte) string {
	trimmed := strings.TrimSpace(string(payload))
	if trimmed == "" {
		return fmt.Sprintf("runner request failed with status %d", status)
	}
	var envelope runnerEnvelope
	if err := json.Unmarshal(payload, &envelope); err == nil && strings.TrimSpace(envelope.Msg) != "" {
		return strings.TrimSpace(envelope.Msg)
	}
	var errorPayload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(payload, &errorPayload); err == nil && strings.TrimSpace(errorPayload.Error) != "" {
		return strings.TrimSpace(errorPayload.Error)
	}
	return fmt.Sprintf("runner request failed with status %d", status)
}

func normalizeToolID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func tailRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[len(runes)-limit:])
}

var commandMarkerPattern = regexp.MustCompile(`__TWC_COPILOT_EXIT_[A-Za-z0-9]+__`)

func ExtractCommandMarker(value string) string {
	return commandMarkerPattern.FindString(value)
}
