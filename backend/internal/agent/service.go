package agent

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"term-webclient-go/backend/internal/config"
	"term-webclient-go/backend/internal/model"
	"term-webclient-go/backend/internal/session"
	"term-webclient-go/backend/internal/util"
	"term-webclient-go/backend/internal/workspace"
)

type plannedStep struct {
	Tool      string
	Title     string
	Arguments map[string]any
	HighRisk  bool
}

type runState struct {
	RunID       string
	SessionID   string
	Instruction string
	Status      model.AgentRunStatus
	Message     *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Steps       []*stepState
}

type stepState struct {
	StepIndex     int
	Tool          string
	Title         string
	Status        model.AgentStepStatus
	HighRisk      bool
	Arguments     map[string]any
	ResultSummary *string
	Error         *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type Service struct {
	cfg       *config.Config
	sessions  *session.Service
	workspace *workspace.Service

	mu                 sync.Mutex
	runsBySession      map[string]map[string]*runState
	activeRunBySession map[string]string
}

func New(cfg *config.Config, sessions *session.Service, workspace *workspace.Service) *Service {
	return &Service{
		cfg:                cfg,
		sessions:           sessions,
		workspace:          workspace,
		runsBySession:      map[string]map[string]*runState{},
		activeRunBySession: map[string]string{},
	}
}

func (s *Service) CreateRun(sessionID string, request model.CreateAgentRunRequest) (model.AgentRunResponse, error) {
	if !s.cfg.Terminal.Agent.Enabled {
		return model.AgentRunResponse{}, util.NewStatusError(http.StatusBadRequest, "agent is disabled", nil)
	}
	if !s.sessions.Exists(sessionID) {
		return model.AgentRunResponse{}, util.NewStatusError(http.StatusBadRequest, "Session not found: "+sessionID, nil)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if activeRunID := s.activeRunBySession[sessionID]; activeRunID != "" {
		return model.AgentRunResponse{}, util.NewStatusError(http.StatusBadRequest, "Another agent run is still active for this session: "+activeRunID, nil)
	}

	context, err := s.sessions.GetContext(sessionID, 100, 200)
	if err != nil {
		return model.AgentRunResponse{}, err
	}
	planned := planSteps(strings.TrimSpace(request.Instruction), context)
	if len(request.SelectedPaths) > 0 {
		includeGitDiff := true
		if request.IncludeGitDiff != nil {
			includeGitDiff = *request.IncludeGitDiff
		}
		planned = append(planned, plannedStep{
			Tool:  "workspace.context_pack",
			Title: "Collect selected code context",
			Arguments: map[string]any{
				"paths":          append([]string(nil), request.SelectedPaths...),
				"includeGitDiff": includeGitDiff,
			},
		})
	}
	if len(planned) == 0 {
		planned = append(planned, plannedStep{
			Tool:      "session.get_context",
			Title:     "Refresh session context",
			Arguments: map[string]any{"commandLimit": 100, "eventLimit": 200},
		})
	}

	now := time.Now().UTC()
	run := &runState{
		RunID:       util.NewID(),
		SessionID:   sessionID,
		Instruction: strings.TrimSpace(request.Instruction),
		Status:      model.AgentRunStatusWaitingApproval,
		Message:     stringPtr("Run drafted. Approve next step to continue."),
		CreatedAt:   now,
		UpdatedAt:   now,
		Steps:       make([]*stepState, 0, len(planned)),
	}
	for idx, item := range planned {
		status := model.AgentStepStatusPending
		if idx == 0 {
			status = model.AgentStepStatusWaitingApproval
		}
		run.Steps = append(run.Steps, &stepState{
			StepIndex: idx + 1,
			Tool:      item.Tool,
			Title:     item.Title,
			Status:    status,
			HighRisk:  item.HighRisk,
			Arguments: item.Arguments,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}

	if s.runsBySession[sessionID] == nil {
		s.runsBySession[sessionID] = map[string]*runState{}
	}
	s.runsBySession[sessionID][run.RunID] = run
	s.activeRunBySession[sessionID] = run.RunID
	return toRunResponse(run), nil
}

func (s *Service) GetRun(sessionID, runID string) (model.AgentRunResponse, error) {
	run, err := s.getRunState(sessionID, runID)
	if err != nil {
		return model.AgentRunResponse{}, err
	}
	return toRunResponse(run), nil
}

func (s *Service) ApproveNextStep(sessionID, runID string, request model.ApproveAgentRunRequest) (model.AgentRunResponse, error) {
	run, err := s.getRunState(sessionID, runID)
	if err != nil {
		return model.AgentRunResponse{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if isTerminalRunStatus(run.Status) {
		return toRunResponse(run), nil
	}
	step := nextAwaitingApprovalStep(run)
	if step == nil {
		run.Status = model.AgentRunStatusCompleted
		run.Message = stringPtr("No pending step left.")
		run.UpdatedAt = time.Now().UTC()
		delete(s.activeRunBySession, sessionID)
		return toRunResponse(run), nil
	}

	confirmRisk := request.ConfirmRisk != nil && *request.ConfirmRisk
	if step.HighRisk && !confirmRisk {
		run.Message = stringPtr("High-risk step requires confirmRisk=true.")
		run.UpdatedAt = time.Now().UTC()
		return toRunResponse(run), nil
	}

	step.Status = model.AgentStepStatusExecuting
	step.UpdatedAt = time.Now().UTC()
	run.Status = model.AgentRunStatusExecutingStep
	run.Message = stringPtr(fmt.Sprintf("Executing step %d...", step.StepIndex))
	run.UpdatedAt = step.UpdatedAt

	result, err := s.executeStep(sessionID, step)
	now := time.Now().UTC()
	step.UpdatedAt = now
	run.UpdatedAt = now
	if err != nil {
		step.Status = model.AgentStepStatusFailed
		errMessage := err.Error()
		step.Error = &errMessage
		run.Status = model.AgentRunStatusFailed
		run.Message = stringPtr("Step execution failed.")
		delete(s.activeRunBySession, sessionID)
		return toRunResponse(run), nil
	}
	step.Status = model.AgentStepStatusCompleted
	step.ResultSummary = stringPtr(result)

	next := nextPendingStep(run)
	if next == nil {
		run.Status = model.AgentRunStatusCompleted
		run.Message = stringPtr("Run completed.")
		delete(s.activeRunBySession, sessionID)
		return toRunResponse(run), nil
	}
	next.Status = model.AgentStepStatusWaitingApproval
	next.UpdatedAt = now
	run.Status = model.AgentRunStatusWaitingApproval
	run.Message = stringPtr(fmt.Sprintf("Step %d completed. Approve step %d.", step.StepIndex, next.StepIndex))
	return toRunResponse(run), nil
}

func (s *Service) Abort(sessionID, runID string, request model.AbortAgentRunRequest) (model.AgentRunResponse, error) {
	run, err := s.getRunState(sessionID, runID)
	if err != nil {
		return model.AgentRunResponse{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if !isTerminalRunStatus(run.Status) {
		for _, step := range run.Steps {
			if step.Status == model.AgentStepStatusPending || step.Status == model.AgentStepStatusWaitingApproval {
				step.Status = model.AgentStepStatusSkipped
				step.UpdatedAt = time.Now().UTC()
			}
		}
		run.Status = model.AgentRunStatusAborted
		message := "Run aborted."
		if strings.TrimSpace(request.Reason) != "" {
			message = "Run aborted: " + strings.TrimSpace(request.Reason)
		}
		run.Message = &message
		run.UpdatedAt = time.Now().UTC()
	}
	delete(s.activeRunBySession, sessionID)
	return toRunResponse(run), nil
}

func (s *Service) getRunState(sessionID, runID string) (*runState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sessionRuns := s.runsBySession[sessionID]
	if sessionRuns == nil {
		return nil, util.NewStatusError(http.StatusNotFound, "agent run not found", nil)
	}
	run := sessionRuns[runID]
	if run == nil {
		return nil, util.NewStatusError(http.StatusNotFound, "agent run not found", nil)
	}
	return run, nil
}

func (s *Service) executeStep(sessionID string, step *stepState) (string, error) {
	switch step.Tool {
	case "session.get_context":
		response, err := s.sessions.GetContext(sessionID, 100, 200)
		if err != nil {
			return "", err
		}
		return truncateString(response.Summary, s.cfg.Terminal.Agent.MaxStepResultChars), nil
	case "session.get_transcript":
		response, err := s.sessions.GetTranscript(sessionID, 0, true)
		if err != nil {
			return "", err
		}
		return truncateString(response.TranscriptText, s.cfg.Terminal.Agent.MaxStepResultChars), nil
	case "terminal.execute_managed":
		command, _ := step.Arguments["command"].(string)
		command = strings.TrimSpace(command)
		if command == "" {
			return "", util.NewStatusError(http.StatusBadRequest, "command is required", nil)
		}
		commandID := "agent-" + util.NewID()
		if err := s.sessions.RegisterManagedCommand(sessionID, commandID, command); err != nil {
			return "", err
		}
		if err := s.sessions.WriteInputFromAgent(sessionID, command+"\n"); err != nil {
			return "", err
		}
		return truncateString("command sent to terminal: "+command, s.cfg.Terminal.Agent.MaxStepResultChars), nil
	case "terminal.send_input":
		data, _ := step.Arguments["data"].(string)
		if data == "" {
			return "", util.NewStatusError(http.StatusBadRequest, "data is required", nil)
		}
		if err := s.sessions.WriteInputFromAgent(sessionID, data); err != nil {
			return "", err
		}
		return truncateString("input sent to terminal", s.cfg.Terminal.Agent.MaxStepResultChars), nil
	case "workspace.context_pack":
		request := model.ContextPackRequest{}
		if rawPaths, ok := step.Arguments["paths"].([]string); ok {
			request.Paths = append([]string(nil), rawPaths...)
		}
		if rawPaths, ok := step.Arguments["paths"].([]any); ok {
			paths := make([]string, 0, len(rawPaths))
			for _, raw := range rawPaths {
				if value, ok := raw.(string); ok {
					paths = append(paths, value)
				}
			}
			request.Paths = paths
		}
		if includeGitDiff, ok := step.Arguments["includeGitDiff"].(bool); ok {
			request.IncludeGitDiff = &includeGitDiff
		}
		response, err := s.workspace.Pack(request)
		if err != nil {
			return "", err
		}
		summary := fmt.Sprintf("workspace context collected: %d entries", len(response.Entries))
		return truncateString(summary, s.cfg.Terminal.Agent.MaxStepResultChars), nil
	default:
		return "", util.NewStatusError(http.StatusBadRequest, "unsupported agent tool: "+step.Tool, nil)
	}
}

func planSteps(instruction string, context model.SessionContextResponse) []plannedStep {
	steps := []plannedStep{
		{
			Tool:      "session.get_context",
			Title:     "Refresh session context",
			Arguments: map[string]any{"commandLimit": 100, "eventLimit": 200},
		},
		{
			Tool:      "session.get_transcript",
			Title:     "Fetch latest transcript",
			Arguments: map[string]any{"afterSeq": maxInt64(0, context.Meta.LastSeq-200), "stripAnsi": true},
		},
	}
	command := extractCommandPrefix(instruction)
	if command != nil {
		if strings.TrimSpace(*command) != "" {
			steps = append(steps, plannedStep{
				Tool:      "terminal.execute_managed",
				Title:     "Execute managed command",
				Arguments: map[string]any{"command": strings.TrimSpace(*command)},
				HighRisk:  looksHighRisk(strings.TrimSpace(*command)),
			})
		}
		return steps
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(instruction)), "input:") {
		data := strings.TrimSpace(instruction[len("input:"):])
		if data != "" {
			if !strings.HasSuffix(data, "\n") {
				data += "\n"
			}
			steps = append(steps, plannedStep{
				Tool:      "terminal.send_input",
				Title:     "Send raw terminal input",
				Arguments: map[string]any{"data": data},
			})
		}
	}
	return steps
}

func extractCommandPrefix(instruction string) *string {
	normalized := strings.TrimSpace(instruction)
	lower := strings.ToLower(normalized)
	switch {
	case strings.HasPrefix(lower, "cmd:"):
		value := strings.TrimSpace(normalized[4:])
		return &value
	case strings.HasPrefix(lower, "command:"):
		value := strings.TrimSpace(normalized[len("command:"):])
		return &value
	default:
		return nil
	}
}

func looksHighRisk(command string) bool {
	normalized := strings.ToLower(command)
	return strings.Contains(normalized, "rm -rf") ||
		strings.Contains(normalized, "mkfs") ||
		strings.Contains(normalized, "shutdown") ||
		strings.Contains(normalized, "reboot") ||
		strings.Contains(normalized, "dd if=")
}

func toRunResponse(run *runState) model.AgentRunResponse {
	steps := make([]model.AgentStepResponse, 0, len(run.Steps))
	for _, step := range run.Steps {
		steps = append(steps, model.AgentStepResponse{
			StepIndex:     step.StepIndex,
			Tool:          step.Tool,
			Title:         step.Title,
			Status:        step.Status,
			HighRisk:      step.HighRisk,
			Arguments:     step.Arguments,
			ResultSummary: step.ResultSummary,
			Error:         step.Error,
			CreatedAt:     step.CreatedAt,
			UpdatedAt:     step.UpdatedAt,
		})
	}
	return model.AgentRunResponse{
		RunID:       run.RunID,
		SessionID:   run.SessionID,
		Instruction: run.Instruction,
		Status:      run.Status,
		Message:     run.Message,
		CreatedAt:   run.CreatedAt,
		UpdatedAt:   run.UpdatedAt,
		Steps:       steps,
	}
}

func nextAwaitingApprovalStep(run *runState) *stepState {
	for _, step := range run.Steps {
		if step.Status == model.AgentStepStatusWaitingApproval {
			return step
		}
	}
	return nil
}

func nextPendingStep(run *runState) *stepState {
	for _, step := range run.Steps {
		if step.Status == model.AgentStepStatusPending {
			return step
		}
	}
	return nil
}

func isTerminalRunStatus(status model.AgentRunStatus) bool {
	return status == model.AgentRunStatusCompleted || status == model.AgentRunStatusFailed || status == model.AgentRunStatusAborted
}

func truncateString(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}

func stringPtr(value string) *string {
	return &value
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
