export type SessionType = "LOCAL_PTY" | "SSH_SHELL";

export interface AuthStatusResponse {
  enabled: boolean;
  authenticated: boolean;
  username: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface CreateSessionRequest {
  sessionType?: SessionType;
  clientId?: string;
  tabTitle?: string;
  toolId?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  workdir?: string;
  cols?: number;
  rows?: number;
  ssh?: {
    credentialId?: string;
    host?: string;
    port?: number;
    username?: string;
    term?: string;
  };
}

export interface CreateSessionResponse {
  sessionId: string;
  wsUrl: string;
  startedAt: string;
}

export interface SessionTabViewResponse {
  sessionId: string;
  title: string;
  sessionType: SessionType;
  toolId: string;
  workdir: string;
  fileRootPath: string;
  startedAt: string;
  wsUrl: string;
  connectionState: string;
}

export interface RecentSessionItemResponse {
  toolId: string;
  title: string;
  sessionType: SessionType;
  workdir: string;
  lastUsedAt: string;
  request: CreateSessionRequest;
}

export type FileEntryType = "FILE" | "DIRECTORY";

export interface FileTreeEntryResponse {
  name: string;
  path: string;
  type: FileEntryType;
  size: number;
  mtime: number;
  readable: boolean;
  writable: boolean;
}

export interface FileTreeResponse {
  currentPath: string;
  parentPath: string | null;
  entries: FileTreeEntryResponse[];
}

export type UploadConflictPolicy = "overwrite" | "rename" | "reject";

export interface FileUploadItemResponse {
  fileName: string;
  status: string;
  savedPath: string | null;
  size: number;
  error: string | null;
}

export interface FileUploadResponse {
  results: FileUploadItemResponse[];
}

export interface FileMkdirRequest {
  parentPath: string;
  name: string;
}

export interface FileMkdirResponse {
  createdPath: string;
  created: boolean;
}

export interface FileDownloadArchiveRequest {
  paths: string[];
  archiveName?: string;
}

export interface FileDownloadTicketRequest {
  mode: "single" | "archive";
  path?: string;
  paths?: string[];
  archiveName?: string;
}

export interface FileDownloadTicketResponse {
  ticket: string;
  downloadUrl: string;
  expiresAt: string;
}

export interface TerminalClientResponse {
  id: string;
  label: string;
  defaultWorkdir: string;
}

export interface SshCredentialSummaryResponse {
  credentialId: string;
  title?: string | null;
  host: string;
  port: number;
  username: string;
  authType: "PASSWORD" | "PRIVATE_KEY";
  createdAt: string;
  updatedAt?: string;
}

export interface SshPreflightResponse {
  credentialId: string;
  success: boolean;
  message: string;
  durationMs: number;
}

export interface CreateSshCredentialRequest {
  title?: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
}

export interface WorkdirEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

export interface WorkdirBrowseResponse {
  rootPath: string;
  currentPath: string;
  entries: WorkdirEntry[];
}

export interface TerminalOutputChunk {
  seq: number;
  data: string;
}

export interface SessionSnapshotResponse {
  sessionId: string;
  fromSeq: number;
  toSeq: number;
  chunks: TerminalOutputChunk[];
  truncated: boolean;
}

export interface SessionMetaState {
  sessionId: string;
  sessionType: SessionType;
  connectionState: string;
  lastSeq: number;
  attachedClients: number;
  lastExitCode: number | null;
  commandCount: number;
  truncated: boolean;
  lastError: string | null;
  lastWorkdir: string | null;
  startedAt: string;
  lastActivityAt: string;
  updatedAt: string;
}

export interface CommandFrame {
  commandId: string;
  source: string;
  command: string;
  boundaryConfidence: number;
  startedAt: string;
  endedAt: string;
  durationMs: number | null;
  exitCode: number | null;
  status: string;
}

export interface SessionEventView {
  eventSeq: number;
  timestamp: string;
  type: string;
  source: string;
  commandId: string | null;
  boundaryConfidence: number | null;
  outputSeq: number | null;
  cols: number | null;
  rows: number | null;
  exitCode: number | null;
  data: string | null;
}

export interface SessionContextResponse {
  sessionId: string;
  meta: SessionMetaState;
  commands: CommandFrame[];
  events: SessionEventView[];
  summary: string;
}

export interface ScreenTextResponse {
  sessionId: string;
  lastSeq: number;
  cols: number;
  rows: number;
  text: string;
}

export interface CreateAssistSuggestionsRequest {
  question?: string;
}

export interface AssistSuggestionItem {
  id: string;
  command: string;
  reason: string;
  weight: number;
}

export interface AssistSuggestionsResponse {
  capturedScreenText: string;
  capturedChars: number;
  suggestions: AssistSuggestionItem[];
}

export type CopilotAgentType = "builtin_assist" | "runner_agent";

export interface CopilotAgentIcon {
  name: string;
  color: string;
}

export interface CopilotAgentSummary {
  key: string;
  label: string;
  description: string;
  type: CopilotAgentType;
  default: boolean;
  icon?: CopilotAgentIcon | null;
}

export interface CopilotChatSummary {
  chatId: string;
  chatName: string;
  agentKey: string;
  teamId?: string;
  createdAt: number;
  updatedAt: number;
  lastRunId: string;
  lastRunContent: string;
  readStatus: number;
  readAt: number | null;
}

export interface CopilotReference {
  id: string;
  type?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
  sha256?: string;
  meta?: Record<string, unknown>;
}

export interface CopilotChatDetail {
  chatId: string;
  chatName: string;
  events: CopilotEventEnvelope[];
  references?: CopilotReference[] | null;
  rawMessages?: Array<Record<string, unknown>> | null;
}

export interface CopilotQueryRequest {
  agentKey: string;
  requestId?: string;
  chatId?: string | null;
  role?: string;
  message: string;
  references?: CopilotReference[];
  params?: Record<string, unknown>;
  scene?: Record<string, unknown>;
}

export interface CopilotSubmitRequest {
  runId: string;
  toolId: string;
  params: unknown;
}

export interface CopilotSubmitResponse {
  accepted: boolean;
  status: string;
  runId: string;
  toolId: string;
  detail: string;
}

export interface CopilotExecuteCommandRequest {
  command: string;
  timeoutSeconds?: number;
}

export interface CopilotExecuteCommandResponse {
  sessionId: string;
  command: string;
  exitCode: number;
  transcriptDelta: string;
  outputExcerpt: string;
  startedAt: string;
  completedAt: string;
}

export interface CopilotEventEnvelope {
  type: string;
  seq?: number;
  timestamp?: number;
  chatId?: string;
  runId?: string;
  toolId?: string;
  toolName?: string;
  toolKey?: string;
  toolType?: string;
  toolTimeout?: number;
  toolParams?: Record<string, unknown>;
  planId?: string;
  plan?: CopilotPlanTask[];
  delta?: string;
  text?: string;
  message?: string;
  role?: string;
  contentId?: string;
  requestId?: string;
  agentKey?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface CopilotPlanTask {
  taskId?: string;
  title?: string;
  status?: string;
  description?: string;
  [key: string]: unknown;
}

export type AgentRunStatus =
  | "DRAFTED"
  | "WAITING_APPROVAL"
  | "EXECUTING_STEP"
  | "COMPLETED"
  | "FAILED"
  | "ABORTED";

export type AgentStepStatus =
  | "PENDING"
  | "WAITING_APPROVAL"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export interface AgentStepResponse {
  stepIndex: number;
  tool: string;
  title: string;
  status: AgentStepStatus;
  highRisk: boolean;
  arguments: Record<string, unknown>;
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunResponse {
  runId: string;
  sessionId: string;
  instruction: string;
  status: AgentRunStatus;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  steps: AgentStepResponse[];
}

export interface CreateAgentRunRequest {
  instruction: string;
  selectedPaths?: string[];
  includeGitDiff?: boolean;
}

export interface ApproveAgentRunRequest {
  confirmRisk?: boolean;
}

export interface AbortAgentRunRequest {
  reason?: string;
}

export interface AppVersionResponse {
  name: string;
  version: string;
  gitSha: string;
  buildTime: string;
}

export interface WsOutputMessage {
  type: "output";
  seq: number;
  data: string;
}

export interface WsErrorMessage {
  type: "error";
  message: string;
}

export interface WsExitMessage {
  type: "exit";
  exitCode: number;
}

export interface WsPongMessage {
  type: "pong";
}

export interface WsTruncatedMessage {
  type: "truncated";
  requestedAfterSeq: number;
  firstAvailableSeq: number;
  latestSeq: number;
}

export type WsServerMessage =
  | WsOutputMessage
  | WsErrorMessage
  | WsExitMessage
  | WsPongMessage
  | WsTruncatedMessage;
