import { apiUrl } from "../config/env";
import type {
  AppVersionResponse,
  AuthStatusResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  CreateSshCredentialRequest,
  LoginRequest,
  SessionTabViewResponse,
  SshCredentialResponse,
  SshCredentialSummaryResponse,
  TerminalClientResponse
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...init
  });

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
    return request<AuthStatusResponse>("/api/auth/me");
  },

  login(payload: LoginRequest): Promise<AuthStatusResponse> {
    return request<AuthStatusResponse>("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  },

  createSession(payload: CreateSessionRequest): Promise<CreateSessionResponse> {
    return request<CreateSessionResponse>("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  },

  listSessions(): Promise<SessionTabViewResponse[]> {
    return request<SessionTabViewResponse[]>("/api/sessions");
  },

  closeSession(sessionId: string): Promise<void> {
    return request<void>(`/api/sessions/${sessionId}`, { method: "DELETE" });
  },

  listTerminalClients(): Promise<TerminalClientResponse[]> {
    return request<TerminalClientResponse[]>("/api/terminal-clients");
  },

  listSshCredentials(): Promise<SshCredentialSummaryResponse[]> {
    return request<SshCredentialSummaryResponse[]>("/api/ssh/credentials");
  },

  createSshCredential(payload: CreateSshCredentialRequest): Promise<SshCredentialResponse> {
    return request<SshCredentialResponse>("/api/ssh/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  },

  deleteSshCredential(credentialId: string): Promise<void> {
    return request<void>(`/api/ssh/credentials/${credentialId}`, { method: "DELETE" });
  },

  getVersion(): Promise<AppVersionResponse> {
    return request<AppVersionResponse>("/api/version");
  }
};
