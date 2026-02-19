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

export interface CreateSshCredentialRequest {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
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

export interface AppVersionResponse {
  name: string;
  version: string;
  gitSha: string;
  buildTime: string;
}
