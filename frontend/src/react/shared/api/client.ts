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
  FileDownloadTicketRequest,
  FileDownloadTicketResponse,
  FileMkdirRequest,
  FileMkdirResponse,
  FileTreeResponse,
  FileUploadResponse,
  UploadConflictPolicy,
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

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadSessionFileRequest {
  targetPath?: string;
  conflictPolicy?: UploadConflictPolicy;
  file: File;
  onProgress?: (progress: UploadProgress) => void;
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

async function resolveAppAuthorizationHeader(): Promise<string | null> {
  if (!isAppMode()) {
    return null;
  }
  let accessToken = getAppAccessToken();
  if (!accessToken) {
    accessToken = await refreshTokenLocked("missing");
  }
  if (!accessToken) {
    return null;
  }
  return `Bearer ${accessToken}`;
}

function toAbsoluteDownloadUrl(downloadUrl: string): string {
  const raw = (downloadUrl || "").trim();
  if (!raw) {
    return raw;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (raw.startsWith("/")) {
    return apiUrl(raw);
  }
  return apiUrl(`/${raw}`);
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

  getSessionFileTree(sessionId: string, path?: string): Promise<FileTreeResponse> {
    if (path && path.trim()) {
      const query = new URLSearchParams({ path: path.trim() });
      return request<FileTreeResponse>(`/sessions/${sessionId}/files/tree?${query.toString()}`);
    }
    return request<FileTreeResponse>(`/sessions/${sessionId}/files/tree`);
  },

  createSessionFileMkdir(sessionId: string, payload: FileMkdirRequest): Promise<FileMkdirResponse> {
    return request<FileMkdirResponse>(`/sessions/${sessionId}/files/mkdir`, {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  createSessionDownloadTicket(sessionId: string, payload: FileDownloadTicketRequest): Promise<FileDownloadTicketResponse> {
    return request<FileDownloadTicketResponse>(`/sessions/${sessionId}/files/download-ticket`, {
      method: "POST",
      headers: withContentTypeJson(new Headers()),
      body: JSON.stringify(payload)
    });
  },

  resolveDownloadUrl(downloadUrl: string): string {
    return toAbsoluteDownloadUrl(downloadUrl);
  },

  async uploadSessionFile(sessionId: string, payload: UploadSessionFileRequest): Promise<FileUploadResponse> {
    if (!payload || !payload.file) {
      throw new ApiError(400, "file is required");
    }

    const formData = new FormData();
    formData.append("targetPath", (payload.targetPath || "").trim());
    formData.append("conflictPolicy", payload.conflictPolicy || "rename");
    formData.append("files", payload.file, payload.file.name);

    const authHeader = await resolveAppAuthorizationHeader();
    const requestUrl = apiUrl(`/sessions/${sessionId}/files/upload`);

    return new Promise<FileUploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", requestUrl, true);
      xhr.withCredentials = !isAppMode();
      if (authHeader) {
        xhr.setRequestHeader("authorization", authHeader);
      }

      xhr.upload.onprogress = (event: ProgressEvent<EventTarget>) => {
        if (!payload.onProgress) {
          return;
        }
        const total = event.lengthComputable ? event.total : payload.file.size;
        const loaded = event.loaded;
        const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        payload.onProgress({ loaded, total, percent });
      };

      xhr.onerror = () => {
        reject(new ApiError(0, "network error"));
      };

      xhr.onload = () => {
        const status = xhr.status;
        const bodyText = xhr.responseText || "";
        if (status >= 200 && status < 300) {
          try {
            const parsed = JSON.parse(bodyText) as FileUploadResponse;
            resolve(parsed);
          } catch {
            reject(new ApiError(status, "invalid upload response"));
          }
          return;
        }

        try {
          const parsed = JSON.parse(bodyText) as { error?: string };
          reject(new ApiError(status, parsed.error || `${status} upload failed`));
        } catch {
          reject(new ApiError(status, `${status} upload failed`));
        }
      };

      xhr.send(formData);
    });
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
