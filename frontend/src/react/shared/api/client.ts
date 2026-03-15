import { apiUrl, isAppMode } from "../config/env";
import { getAppAccessToken, refreshAppAccessToken } from "../auth/appBridge";
import type {
  AbortAgentRunRequest,
  AgentRunResponse,
  AssistSuggestionsResponse,
  ApproveAgentRunRequest,
  AppVersionResponse,
  AuthStatusResponse,
  CopilotAgentSummary,
  CopilotChatDetail,
  CopilotChatSummary,
  CopilotEventEnvelope,
  CopilotExecuteCommandRequest,
  CopilotExecuteCommandResponse,
  CopilotQueryRequest,
  CopilotSubmitRequest,
  CopilotSubmitResponse,
  RecentSessionItemResponse,
  CreateAgentRunRequest,
  CreateAssistSuggestionsRequest,
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
  TerminalDefaultsResponse,
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

export interface StreamCopilotQueryOptions {
  signal?: AbortSignal;
  onEvent: (event: CopilotEventEnvelope) => void;
}

export interface UploadSessionFileRequest {
  targetPath?: string;
  conflictPolicy?: UploadConflictPolicy;
  file: File;
  onProgress?: (progress: UploadProgress) => void;
}

let tokenRefreshPromise: Promise<string | null> | null = null;

function shouldSetJsonContentType(method: string | undefined, headers: Headers, body: BodyInit | null | undefined): boolean {
  if ((method || "GET").toUpperCase() !== "POST") {
    return false;
  }
  if (!body || body instanceof FormData) {
    return false;
  }
  return !headers.has("content-type");
}

function applyJsonContentType(headers: Headers, method: string | undefined, body: BodyInit | null | undefined): void {
  if (shouldSetJsonContentType(method, headers, body)) {
    headers.set("content-type", "application/json");
  }
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    const normalized = typeof value === "number" ? String(value) : value.trim();
    if (!normalized) {
      return;
    }
    query.set(key, normalized);
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
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
  applyJsonContentType(headers, requestInit.method, requestInit.body);

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

function decodeSseFrames(source: string): Array<{ data: string }> {
  const frames = source.split("\n\n");
  const result: Array<{ data: string }> = [];
  for (const frame of frames) {
    const trimmed = frame.trim();
    if (!trimmed) {
      continue;
    }
    const dataLines = trimmed.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }
    result.push({ data: dataLines.join("\n") });
  }
  return result;
}

async function requestStream(
  path: string,
  init: RequestInit,
  { signal, onEvent }: StreamCopilotQueryOptions
): Promise<void> {
  const appMode = isAppMode();
  const headers = new Headers(init.headers ?? undefined);
  const requestInit: RequestInit = {
    ...init,
    headers,
    credentials: appMode ? "omit" : "include",
    signal
  };
  applyJsonContentType(headers, requestInit.method, requestInit.body);

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
  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }
  if (!response.body) {
    throw new ApiError(response.status, "empty stream response");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const frame of decodeSseFrames(part + "\n\n")) {
        if (frame.data === "[DONE]") {
          return;
        }
        const parsed = JSON.parse(frame.data) as CopilotEventEnvelope;
        onEvent(parsed);
      }
    }
    if (done) {
      break;
    }
  }
  const tail = buffer.trim();
  if (tail) {
    for (const frame of decodeSseFrames(tail + "\n\n")) {
      if (frame.data === "[DONE]") {
        return;
      }
      const parsed = JSON.parse(frame.data) as CopilotEventEnvelope;
      onEvent(parsed);
    }
  }
}

export const apiClient = {
  getAuthStatus(): Promise<AuthStatusResponse> {
    return request<AuthStatusResponse>("/auth/me");
  },

  login(payload: LoginRequest): Promise<AuthStatusResponse> {
    return request<AuthStatusResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },

  createSession(payload: CreateSessionRequest): Promise<CreateSessionResponse> {
    return request<CreateSessionResponse>("/sessions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  listSessions(): Promise<SessionTabViewResponse[]> {
    return request<SessionTabViewResponse[]>("/sessions");
  },

  listRecentSessions(toolId: string): Promise<RecentSessionItemResponse[]> {
    return request<RecentSessionItemResponse[]>(`/sessions/recent${buildQuery({ toolId })}`);
  },

  closeSession(sessionId: string): Promise<void> {
    return request<void>(`/sessions/${sessionId}`, { method: "DELETE" });
  },

  listTerminalClients(): Promise<TerminalClientResponse[]> {
    return request<TerminalClientResponse[]>("/terminal/clients");
  },

  getTerminalDefaults(): Promise<TerminalDefaultsResponse> {
    return request<TerminalDefaultsResponse>("/terminal/defaults");
  },

  listSshCredentials(): Promise<SshCredentialSummaryResponse[]> {
    return request<SshCredentialSummaryResponse[]>("/ssh/credentials");
  },

  createSshCredential(payload: CreateSshCredentialRequest): Promise<SshCredentialSummaryResponse> {
    return request<SshCredentialSummaryResponse>("/ssh/credentials", {
      method: "POST",
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
    return request<WorkdirBrowseResponse>(`/workdirTree${buildQuery({ path })}`);
  },

  getSessionSnapshot(sessionId: string, afterSeq: number): Promise<SessionSnapshotResponse> {
    return request<SessionSnapshotResponse>(`/sessions/${sessionId}/snapshot${buildQuery({
      afterSeq: Math.max(0, Math.floor(afterSeq))
    })}`);
  },

  getSessionContext(sessionId: string, commandLimit = 120, eventLimit = 300): Promise<SessionContextResponse> {
    return request<SessionContextResponse>(`/sessions/${sessionId}/context${buildQuery({
      commandLimit,
      eventLimit
    })}`);
  },

  getSessionScreenText(sessionId: string): Promise<ScreenTextResponse> {
    return request<ScreenTextResponse>(`/sessions/${sessionId}/screen-text`);
  },

  getSessionFileTree(sessionId: string, path?: string): Promise<FileTreeResponse> {
    return request<FileTreeResponse>(`/sessions/${sessionId}/files/tree${buildQuery({ path })}`);
  },

  createSessionFileMkdir(sessionId: string, payload: FileMkdirRequest): Promise<FileMkdirResponse> {
    return request<FileMkdirResponse>(`/sessions/${sessionId}/files/mkdir`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  createSessionDownloadTicket(sessionId: string, payload: FileDownloadTicketRequest): Promise<FileDownloadTicketResponse> {
    return request<FileDownloadTicketResponse>(`/sessions/${sessionId}/files/download-ticket`, {
      method: "POST",
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

  createAssistSuggestions(sessionId: string, payload: CreateAssistSuggestionsRequest = {}): Promise<AssistSuggestionsResponse> {
    return request<AssistSuggestionsResponse>(`/sessions/${sessionId}/assist/suggestions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  createAgentRun(sessionId: string, payload: CreateAgentRunRequest): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getAgentRun(sessionId: string, runId: string): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs/${runId}`);
  },

  approveAgentRun(sessionId: string, runId: string, payload: ApproveAgentRunRequest = {}): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs/${runId}/approve`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  abortAgentRun(sessionId: string, runId: string, payload: AbortAgentRunRequest = {}): Promise<AgentRunResponse> {
    return request<AgentRunResponse>(`/sessions/${sessionId}/agent/runs/${runId}/abort`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  listCopilotAgents(sessionId: string): Promise<CopilotAgentSummary[]> {
    return request<CopilotAgentSummary[]>(`/sessions/${sessionId}/copilot/agents`);
  },

  listCopilotChats(sessionId: string, agentKey: string, lastRunId?: string): Promise<CopilotChatSummary[]> {
    return request<CopilotChatSummary[]>(`/sessions/${sessionId}/copilot/chats${buildQuery({
      agentKey,
      lastRunId
    })}`);
  },

  getCopilotChat(sessionId: string, chatId: string): Promise<CopilotChatDetail> {
    return request<CopilotChatDetail>(`/sessions/${sessionId}/copilot/chats/${encodeURIComponent(chatId)}`);
  },

  streamCopilotQuery(sessionId: string, payload: CopilotQueryRequest, options: StreamCopilotQueryOptions): Promise<void> {
    return requestStream(
      `/sessions/${sessionId}/copilot/query`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      options
    );
  },

  submitCopilotTool(sessionId: string, payload: CopilotSubmitRequest): Promise<CopilotSubmitResponse> {
    return request<CopilotSubmitResponse>(`/sessions/${sessionId}/copilot/submit`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  executeCopilotCommand(sessionId: string, payload: CopilotExecuteCommandRequest): Promise<CopilotExecuteCommandResponse> {
    return request<CopilotExecuteCommandResponse>(`/sessions/${sessionId}/copilot/commands/execute`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getVersion(): Promise<AppVersionResponse> {
    return request<AppVersionResponse>("/version");
  }
};
