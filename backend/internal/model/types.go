package model

import "time"

type SessionType string

const (
	SessionTypeLocalPTY SessionType = "LOCAL_PTY"
	SessionTypeSSHShell SessionType = "SSH_SHELL"
)

func NormalizeSessionType(value SessionType) SessionType {
	switch value {
	case SessionTypeSSHShell:
		return SessionTypeSSHShell
	default:
		return SessionTypeLocalPTY
	}
}

type AuthStatusResponse struct {
	Enabled       bool   `json:"enabled"`
	Authenticated bool   `json:"authenticated"`
	Username      string `json:"username"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type CreateSessionRequest struct {
	SessionType SessionType        `json:"sessionType"`
	ClientID    string             `json:"clientId"`
	TabTitle    string             `json:"tabTitle"`
	ToolID      string             `json:"toolId"`
	Command     string             `json:"command"`
	Args        []string           `json:"args"`
	Env         map[string]string  `json:"env"`
	Workdir     string             `json:"workdir"`
	Cols        *int               `json:"cols"`
	Rows        *int               `json:"rows"`
	SSH         *SshSessionRequest `json:"ssh"`
}

type SshSessionRequest struct {
	CredentialID string `json:"credentialId"`
	Host         string `json:"host"`
	Port         *int   `json:"port"`
	Username     string `json:"username"`
	Term         string `json:"term"`
}

type CreateSessionResponse struct {
	SessionID string    `json:"sessionId"`
	WSURL     string    `json:"wsUrl"`
	StartedAt time.Time `json:"startedAt"`
}

type SessionTabViewResponse struct {
	SessionID       string      `json:"sessionId"`
	WSURL           string      `json:"wsUrl"`
	Title           string      `json:"title"`
	ToolID          string      `json:"toolId"`
	SessionType     SessionType `json:"sessionType"`
	Workdir         string      `json:"workdir"`
	FileRootPath    string      `json:"fileRootPath"`
	StartedAt       time.Time   `json:"startedAt"`
	ConnectionState string      `json:"connectionState"`
}

type RecentSessionItemResponse struct {
	ToolID      string               `json:"toolId"`
	Title       string               `json:"title"`
	SessionType SessionType          `json:"sessionType"`
	Workdir     string               `json:"workdir"`
	LastUsedAt  time.Time            `json:"lastUsedAt"`
	Request     CreateSessionRequest `json:"request"`
}

type WorkdirEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	HasChildren bool   `json:"hasChildren"`
}

type WorkdirBrowseResponse struct {
	RootPath    string         `json:"rootPath"`
	CurrentPath string         `json:"currentPath"`
	Entries     []WorkdirEntry `json:"entries"`
}

type TerminalOutputChunk struct {
	Seq  int64  `json:"seq"`
	Data string `json:"data"`
}

type SessionSnapshotResponse struct {
	SessionID string                `json:"sessionId"`
	FromSeq   int64                 `json:"fromSeq"`
	ToSeq     int64                 `json:"toSeq"`
	Chunks    []TerminalOutputChunk `json:"chunks"`
	Truncated bool                  `json:"truncated"`
}

type TranscriptResponse struct {
	SessionID      string `json:"sessionId"`
	FromSeq        int64  `json:"fromSeq"`
	ToSeq          int64  `json:"toSeq"`
	ChunkCount     int    `json:"chunkCount"`
	Truncated      bool   `json:"truncated"`
	StripAnsi      bool   `json:"stripAnsi"`
	TranscriptText string `json:"transcriptText"`
}

type SessionMetaState struct {
	SessionID       string      `json:"sessionId"`
	SessionType     SessionType `json:"sessionType"`
	ConnectionState string      `json:"connectionState"`
	LastSeq         int64       `json:"lastSeq"`
	AttachedClients int         `json:"attachedClients"`
	LastExitCode    *int        `json:"lastExitCode"`
	CommandCount    int         `json:"commandCount"`
	Truncated       bool        `json:"truncated"`
	LastError       string      `json:"lastError"`
	LastWorkdir     string      `json:"lastWorkdir"`
	StartedAt       time.Time   `json:"startedAt"`
	LastActivityAt  time.Time   `json:"lastActivityAt"`
	UpdatedAt       time.Time   `json:"updatedAt"`
}

type CommandFrame struct {
	CommandID          string     `json:"commandId"`
	Source             string     `json:"source"`
	Command            string     `json:"command"`
	BoundaryConfidence float64    `json:"boundaryConfidence"`
	StartedAt          *time.Time `json:"startedAt"`
	EndedAt            *time.Time `json:"endedAt"`
	DurationMs         *int64     `json:"durationMs"`
	ExitCode           *int       `json:"exitCode"`
	Status             string     `json:"status"`
}

type SessionEventView struct {
	EventSeq           int64     `json:"eventSeq"`
	Timestamp          time.Time `json:"timestamp"`
	Type               string    `json:"type"`
	Source             string    `json:"source"`
	CommandID          *string   `json:"commandId"`
	BoundaryConfidence *float64  `json:"boundaryConfidence"`
	OutputSeq          *int64    `json:"outputSeq"`
	Cols               *int      `json:"cols"`
	Rows               *int      `json:"rows"`
	ExitCode           *int      `json:"exitCode"`
	Data               *string   `json:"data"`
}

type SessionContextResponse struct {
	SessionID string             `json:"sessionId"`
	Meta      SessionMetaState   `json:"meta"`
	Commands  []CommandFrame     `json:"commands"`
	Events    []SessionEventView `json:"events"`
	Summary   string             `json:"summary"`
}

type ScreenTextResponse struct {
	SessionID string `json:"sessionId"`
	LastSeq   int64  `json:"lastSeq"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
	Text      string `json:"text"`
}

type CreateAssistSuggestionsRequest struct {
	Question string `json:"question"`
}

type AssistSuggestionItem struct {
	ID      string `json:"id"`
	Command string `json:"command"`
	Reason  string `json:"reason"`
	Weight  int    `json:"weight"`
}

type AssistSuggestionsResponse struct {
	CapturedScreenText string                 `json:"capturedScreenText"`
	CapturedChars      int                    `json:"capturedChars"`
	Suggestions        []AssistSuggestionItem `json:"suggestions"`
}

type CopilotAgentType string

const (
	CopilotAgentTypeBuiltinAssist CopilotAgentType = "builtin_assist"
	CopilotAgentTypeRunnerAgent   CopilotAgentType = "runner_agent"
)

type CopilotAgentIcon struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type CopilotAgentResponse struct {
	Key         string            `json:"key"`
	Label       string            `json:"label"`
	Description string            `json:"description"`
	Type        CopilotAgentType  `json:"type"`
	Default     bool              `json:"default"`
	Icon        *CopilotAgentIcon `json:"icon,omitempty"`
}

type CopilotChatSummaryResponse struct {
	ChatID         string `json:"chatId"`
	ChatName       string `json:"chatName"`
	AgentKey       string `json:"agentKey"`
	TeamID         string `json:"teamId,omitempty"`
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
	LastRunID      string `json:"lastRunId"`
	LastRunContent string `json:"lastRunContent"`
	ReadStatus     int    `json:"readStatus"`
	ReadAt         *int64 `json:"readAt"`
}

type CopilotReference struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	MIMEType  string         `json:"mimeType"`
	SizeBytes *int64         `json:"sizeBytes"`
	URL       string         `json:"url"`
	SHA256    string         `json:"sha256"`
	Meta      map[string]any `json:"meta"`
}

type CopilotChatDetailResponse struct {
	ChatID      string             `json:"chatId"`
	ChatName    string             `json:"chatName"`
	Events      []map[string]any   `json:"events"`
	References  []CopilotReference `json:"references,omitempty"`
	RawMessages []map[string]any   `json:"rawMessages,omitempty"`
}

type CopilotQueryRequest struct {
	AgentKey   string             `json:"agentKey"`
	RequestID  string             `json:"requestId"`
	ChatID     string             `json:"chatId"`
	Role       string             `json:"role"`
	Message    string             `json:"message"`
	References []CopilotReference `json:"references"`
	Params     map[string]any     `json:"params"`
	Scene      map[string]any     `json:"scene"`
}

type CopilotSubmitRequest struct {
	RunID  string `json:"runId"`
	ToolID string `json:"toolId"`
	Params any    `json:"params"`
}

type CopilotSubmitResponse struct {
	Accepted bool   `json:"accepted"`
	Status   string `json:"status"`
	RunID    string `json:"runId"`
	ToolID   string `json:"toolId"`
	Detail   string `json:"detail"`
}

type CopilotExecuteCommandRequest struct {
	Command        string `json:"command"`
	TimeoutSeconds *int   `json:"timeoutSeconds"`
}

type CopilotExecuteCommandResponse struct {
	SessionID       string    `json:"sessionId"`
	Command         string    `json:"command"`
	ExitCode        int       `json:"exitCode"`
	TranscriptDelta string    `json:"transcriptDelta"`
	OutputExcerpt   string    `json:"outputExcerpt"`
	StartedAt       time.Time `json:"startedAt"`
	CompletedAt     time.Time `json:"completedAt"`
}

type TerminalClientResponse struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	DefaultWorkdir string `json:"defaultWorkdir"`
}

type TerminalDefaultsResponse struct {
	Command string   `json:"command"`
	Args    []string `json:"args"`
	Workdir string   `json:"workdir"`
}

type SshAuthType string

const (
	SshAuthPassword   SshAuthType = "PASSWORD"
	SshAuthPrivateKey SshAuthType = "PRIVATE_KEY"
)

type CreateSshCredentialRequest struct {
	Title                string `json:"title"`
	Host                 string `json:"host"`
	Port                 *int   `json:"port"`
	Username             string `json:"username"`
	Password             string `json:"password"`
	PrivateKey           string `json:"privateKey"`
	PrivateKeyPassphrase string `json:"privateKeyPassphrase"`
}

type SshCredentialResponse struct {
	CredentialID string      `json:"credentialId"`
	Title        string      `json:"title,omitempty"`
	Host         string      `json:"host"`
	Port         int         `json:"port"`
	Username     string      `json:"username"`
	AuthType     SshAuthType `json:"authType"`
	CreatedAt    time.Time   `json:"createdAt"`
	UpdatedAt    *time.Time  `json:"updatedAt,omitempty"`
}

type SshPreflightResponse struct {
	CredentialID string `json:"credentialId"`
	Success      bool   `json:"success"`
	Message      string `json:"message"`
	DurationMs   int64  `json:"durationMs"`
}

type SshExecRequest struct {
	CredentialID   string            `json:"credentialId"`
	Command        string            `json:"command"`
	Cwd            string            `json:"cwd"`
	Env            map[string]string `json:"env"`
	TimeoutSeconds *int              `json:"timeoutSeconds"`
}

type SshExecResponse struct {
	Stdout          string `json:"stdout"`
	Stderr          string `json:"stderr"`
	ExitCode        int    `json:"exitCode"`
	DurationMs      int64  `json:"durationMs"`
	TimedOut        bool   `json:"timedOut"`
	StdoutTruncated bool   `json:"stdoutTruncated"`
	StderrTruncated bool   `json:"stderrTruncated"`
}

type SystemVersionResponse struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	GitSHA    string `json:"gitSha"`
	BuildTime string `json:"buildTime"`
}

type FileEntryType string

const (
	FileEntryTypeFile      FileEntryType = "FILE"
	FileEntryTypeDirectory FileEntryType = "DIRECTORY"
)

type FileTreeEntryResponse struct {
	Name     string        `json:"name"`
	Path     string        `json:"path"`
	Type     FileEntryType `json:"type"`
	Size     int64         `json:"size"`
	Mtime    int64         `json:"mtime"`
	Readable bool          `json:"readable"`
	Writable bool          `json:"writable"`
}

type FileTreeResponse struct {
	CurrentPath string                  `json:"currentPath"`
	ParentPath  *string                 `json:"parentPath"`
	Entries     []FileTreeEntryResponse `json:"entries"`
}

type UploadConflictPolicy string

const (
	UploadConflictPolicyOverwrite UploadConflictPolicy = "overwrite"
	UploadConflictPolicyRename    UploadConflictPolicy = "rename"
	UploadConflictPolicyReject    UploadConflictPolicy = "reject"
)

type FileUploadItemResponse struct {
	FileName  string  `json:"fileName"`
	Status    string  `json:"status"`
	SavedPath *string `json:"savedPath"`
	Size      int64   `json:"size"`
	Error     *string `json:"error"`
}

type FileUploadResponse struct {
	Results []FileUploadItemResponse `json:"results"`
}

type FileMkdirRequest struct {
	ParentPath string `json:"parentPath"`
	Name       string `json:"name"`
}

type FileMkdirResponse struct {
	CreatedPath string `json:"createdPath"`
	Created     bool   `json:"created"`
}

type FileDownloadArchiveRequest struct {
	Paths       []string `json:"paths"`
	ArchiveName string   `json:"archiveName"`
}

type FileDownloadTicketRequest struct {
	Mode        string   `json:"mode"`
	Path        string   `json:"path"`
	Paths       []string `json:"paths"`
	ArchiveName string   `json:"archiveName"`
}

type FileDownloadTicketResponse struct {
	Ticket      string    `json:"ticket"`
	DownloadURL string    `json:"downloadUrl"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type ContextPackRequest struct {
	Paths          []string `json:"paths"`
	IncludeGitDiff *bool    `json:"includeGitDiff"`
	MaxBytes       *int     `json:"maxBytes"`
}

type ContextPackEntryResponse struct {
	Path      string `json:"path"`
	Found     bool   `json:"found"`
	Truncated bool   `json:"truncated"`
	Bytes     int    `json:"bytes"`
	Content   string `json:"content"`
	Error     string `json:"error"`
}

type ContextPackResponse struct {
	GeneratedAt   time.Time                  `json:"generatedAt"`
	WorkspaceRoot string                     `json:"workspaceRoot"`
	Truncated     bool                       `json:"truncated"`
	Entries       []ContextPackEntryResponse `json:"entries"`
	GitDiff       string                     `json:"gitDiff"`
}

type AgentRunStatus string

const (
	AgentRunStatusDrafted         AgentRunStatus = "DRAFTED"
	AgentRunStatusWaitingApproval AgentRunStatus = "WAITING_APPROVAL"
	AgentRunStatusExecutingStep   AgentRunStatus = "EXECUTING_STEP"
	AgentRunStatusCompleted       AgentRunStatus = "COMPLETED"
	AgentRunStatusFailed          AgentRunStatus = "FAILED"
	AgentRunStatusAborted         AgentRunStatus = "ABORTED"
)

type AgentStepStatus string

const (
	AgentStepStatusPending         AgentStepStatus = "PENDING"
	AgentStepStatusWaitingApproval AgentStepStatus = "WAITING_APPROVAL"
	AgentStepStatusExecuting       AgentStepStatus = "EXECUTING"
	AgentStepStatusCompleted       AgentStepStatus = "COMPLETED"
	AgentStepStatusFailed          AgentStepStatus = "FAILED"
	AgentStepStatusSkipped         AgentStepStatus = "SKIPPED"
)

type AgentStepResponse struct {
	StepIndex     int             `json:"stepIndex"`
	Tool          string          `json:"tool"`
	Title         string          `json:"title"`
	Status        AgentStepStatus `json:"status"`
	HighRisk      bool            `json:"highRisk"`
	Arguments     map[string]any  `json:"arguments"`
	ResultSummary *string         `json:"resultSummary"`
	Error         *string         `json:"error"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

type AgentRunResponse struct {
	RunID       string              `json:"runId"`
	SessionID   string              `json:"sessionId"`
	Instruction string              `json:"instruction"`
	Status      AgentRunStatus      `json:"status"`
	Message     *string             `json:"message"`
	CreatedAt   time.Time           `json:"createdAt"`
	UpdatedAt   time.Time           `json:"updatedAt"`
	Steps       []AgentStepResponse `json:"steps"`
}

type CreateAgentRunRequest struct {
	Instruction    string   `json:"instruction"`
	SelectedPaths  []string `json:"selectedPaths"`
	IncludeGitDiff *bool    `json:"includeGitDiff"`
}

type ApproveAgentRunRequest struct {
	ConfirmRisk *bool `json:"confirmRisk"`
}

type AbortAgentRunRequest struct {
	Reason string `json:"reason"`
}
