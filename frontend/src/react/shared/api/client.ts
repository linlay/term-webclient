import { apiUrl, isAppMode } from "../config/env";
import { getAppAccessToken, refreshAppAccessToken } from "../auth/appBridge";
import type {
  AbortAgentRunRequest,
  AgentRunResponse,
  ApproveAgentRunRequest,
  AppVersionResponse,
  AuthStatusResponse,
  CreateAgentRunRequest,
  CreateSessionRequest,
  CreateSessionResponse,
  CreateSshCredentialRequest,
  LoginRequest,
  ScreenTextResponse,
  SessionContextResponse,
  SessionSnapshotResponse,
  SessionTabViewResponse,
  SshPreflightResponse,
  SshCredentialSummaryResponse,
  TerminalClientResponse,
  WorkdirBrowseResponse
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let tokenRefreshPromise: Promise<string | null> | null = null;

function withContentTypeJson(headers: Headers): Headers {
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // ignore malformed body
  }
  return `${response.status} ${response.statusText}`;
}

async function refreshTokenLocked(reason: "missing" | "unauthorized"): Promise<string | null> {
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }
  tokenRefreshPromise = refreshAppAccessToken(reason).finally(() => {
    tokenRefreshPromise = null;
  });
  return tokenRefreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, allowReplay = true): Promise<T> {
  const appMode = isAppMode();
  const headers = new Headers(init.headers ?? undefined);

  const requestInit: RequestInit = {
    ...init,
    headers,
    credentials: appMode ? "omit" : "include"
  };

  if (appMode) {
    let accessToken = getAppAccessToken();
    if (!accessToken) {
      accessToken = await refreshTokenLocked("missing");
    }
    if (accessToken) {
      headers.set("authorization", `Bearer ${accessToken}`);
    }
  }

  const response = await fetch(apiUrl(path), requestInit);

  if (response.status === 401 && appMode && allowReplay) {
    const refreshedToken = await refreshTokenLocked("unauthorized");
    if (refreshedToken) {
      return request<T>(path, init, false);
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  getAuthStatus(): Promise<AuthStatusResponse> {
    return request<AuthStatusResponse>("/auth/me");
  },

  login(payload: LoginRequest): Promise<AuthStatusResponse> {
    return request<AuthStatusResponse>("/auth/login", {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },

  createSession(payload: CreateSessionRequest): Promise<CreateSessionResponse> {
    return request<CreateSessionResponse>("/sessions", {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  listSessions(): Promise<SessionTabViewResponse[]> {
    return request<SessionTabViewResponse[]>("/sessions");
  },

  closeSession(sessionId: string): Promise<void> {
    return request<void>(`/sessions/${sessionId}`, { method: "DELETE" });
  },

  listTerminalClients(): Promise<TerminalClientResponse[]> {
    return request<TerminalClientResponse[]>("/terminal/clients");
  },

  listSshCredentials(): Promise<SshCredentialSummaryResponse[]> {
    return request<SshCredentialSummaryResponse[]>("/ssh/credentials");
  },

  createSshCredential(payload: CreateSshCredentialRequest): Promise<SshCredentialSummaryResponse> {
    return request<SshCredentialSummaryResponse>("/ssh/credentials", {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  deleteSshCredential(credentialId: string): Promise<void> {
    return request<void>(`/ssh/credentials/${credentialId}`, { method: "DELETE" });
  },

  preflightSshCredential(credentialId: string): Promise<SshPreflightResponse> {
    return request<SshPreflightResponse>(`/ssh/credentials/${credentialId}/preflight`, {
      method: "POST"
    });
  },

  getWorkdirTree(path?: string): Promise<WorkdirBrowseResponse> {
    if (path && path.trim()) {
      const query = new URLSearchParams({ path: path.trim() });
      return request<WorkdirBrowseResponse>(`/workdirTree?${query.toString()}`);
    }
    return request<WorkdirBrowseResponse>("/workdirTree");
  },

  getSessionSnapshot(sessionId: string, afterSeq: number): Promise<SessionSnapshotResponse> {
    const query = new URLSearchParams({ afterSeq: String(Math.max(0, Math.floor(afterSeq))) });
    return request<SessionSnapshotResponse>(`/sessions/${sessionId}/snapshot?${query.toString()}`);
  },

  getSessionContext(sessionId: string, commandLimit = 120, eventLimit = 300): Promise<SessionContextResponse> {
    const query = new URLSearchParams({
      commandLimit: String(commandLimit),
      eventLimit: String(eventLimit)
    });
    return request<SessionContextResponse>(`/sessions/${sessionId}/context?${query.toString()}`);
  },

  getSessionScreenText(sessionId: string): Promise<ScreenTextResponse> {
    return request<ScreenTextResponse>(`/sessions/${sessionId}/screen-text`);
  },

  createAgentRun(sessionId: string, payload: CreateAgentRunRequest): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs`, {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  getAgentRun(sessionId: string, runId: string): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs/${runId}`);
  },

  approveAgentRun(sessionId: string, runId: string, payload: ApproveAgentRunRequest = {}): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs/${runId}/approve`, {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  abortAgentRun(sessionId: string, runId: string, payload: AbortAgentRunRequest = {}): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs/${runId}/abort`, {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  getVersion(): Promise<AppVersionResponse> {
    return request<AppVersionResponse>("/version");
  }
};
