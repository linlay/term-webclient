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
  startedAt: string;
  wsUrl: string;
  connectionState: string;
}

export interface TerminalClientResponse {
  id: string;
  label: string;
  defaultWorkdir: string;
}

export interface SshCredentialSummaryResponse {
  credentialId: string;
  host: string;
  port: number;
  username: string;
  authType: "PASSWORD" | "PRIVATE_KEY";
  createdAt: string;
  updatedAt: string;
}

export interface SshCredentialResponse {
  credentialId: string;
  host: string;
  port: number;
  username: string;
  authType: "PASSWORD" | "PRIVATE_KEY";
  createdAt: string;
  updatedAt: string;
}

export interface SshPreflightResponse {
  credentialId: string;
  success: boolean;
  message: string;
  durationMs: number;
}

export interface CreateSshCredentialRequest {
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
