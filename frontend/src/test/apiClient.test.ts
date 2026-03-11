import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError, buildQuery } from "../react/shared/api/client";

function mockJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("apiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({ enabled: true, authenticated: true, username: "admin" })
    );

    await expect(apiClient.getAuthStatus()).resolves.toMatchObject({
      enabled: true,
      authenticated: true,
      username: "admin"
    });
  });

  it("throws ApiError for non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({ error: "unauthorized" }, 401)
    );

    await expect(apiClient.getAuthStatus()).rejects.toBeInstanceOf(ApiError);
  });

  it("requests workdir tree with encoded path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        rootPath: "/",
        currentPath: "/tmp",
        entries: []
      })
    );

    await apiClient.getWorkdirTree("/tmp/my folder");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/workdirTree?path=%2Ftmp%2Fmy+folder");
  });

  it("builds query strings while skipping empty values", () => {
    expect(buildQuery({
      path: "/tmp/my folder",
      empty: "   ",
      count: 12,
      missing: undefined,
      nullable: null
    })).toBe("?path=%2Ftmp%2Fmy+folder&count=12");
  });

  it("requests snapshot with afterSeq", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        sessionId: "s1",
        fromSeq: 0,
        toSeq: 2,
        chunks: [],
        truncated: false
      })
    );

    await apiClient.getSessionSnapshot("s1", 12);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/s1/snapshot?afterSeq=12");
  });

  it("supports agent run create / approve / abort APIs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({
        runId: "r1",
        sessionId: "s1",
        instruction: "check",
        status: "WAITING_APPROVAL",
        message: "ok",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        steps: []
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        runId: "r1",
        sessionId: "s1",
        instruction: "check",
        status: "EXECUTING_STEP",
        message: "approved",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:01Z",
        steps: []
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        runId: "r1",
        sessionId: "s1",
        instruction: "check",
        status: "ABORTED",
        message: "aborted",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:02Z",
        steps: []
      }));

    await apiClient.createAgentRun("s1", { instruction: "check", selectedPaths: [], includeGitDiff: true });
    await apiClient.approveAgentRun("s1", "r1", { confirmRisk: true });
    await apiClient.abortAgentRun("s1", "r1", { reason: "manual abort" });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/s1/agent/runs");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("/term/api/sessions/s1/agent/runs/r1/approve");
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("/term/api/sessions/s1/agent/runs/r1/abort");
  });

  it("requests assist suggestions via session assist api", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        capturedScreenText: "git status",
        capturedChars: 10,
        suggestions: [
          { id: "git-status-short", command: "git status --short", reason: "Check repo state.", weight: 92 }
        ]
      })
    );

    await apiClient.createAssistSuggestions("s1", { question: "What next?" });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/s1/assist/suggestions");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("application/json");
  });

  it("does not append blank query values to recent sessions requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockJsonResponse([]));

    await apiClient.listRecentSessions("   ");
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/recent");
  });

  it("requests session file tree with encoded path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        currentPath: "/tmp",
        parentPath: "/",
        entries: []
      })
    );

    await apiClient.getSessionFileTree("s1", "/tmp/my folder");
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/s1/files/tree?path=%2Ftmp%2Fmy+folder");
  });

  it("creates download ticket via session files api", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse({
        ticket: "t1",
        downloadUrl: "/term/api/sessions/s1/files/download?ticket=t1",
        expiresAt: "2026-02-24T00:00:00Z"
      }, 201)
    );

    await apiClient.createSessionDownloadTicket("s1", { mode: "single", path: "/tmp/a.txt" });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/s1/files/download-ticket");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("resolves relative download url to api base path", () => {
    expect(apiClient.resolveDownloadUrl("/term/api/sessions/s1/files/download?ticket=t1"))
      .toBe("/term/api/sessions/s1/files/download?ticket=t1");
  });

  it("uploads file with xhr progress events", async () => {
    type HeadersMap = Record<string, string>;
    class MockXHR {
      static created: MockXHR[] = [];
      method = "";
      url = "";
      async = true;
      withCredentials = false;
      status = 200;
      responseText = JSON.stringify({
        results: [
          { fileName: "a.txt", status: "SUCCESS", savedPath: "/tmp/a.txt", size: 1, error: null }
        ]
      });
      headers: HeadersMap = {};
      body: FormData | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };

      constructor() {
        MockXHR.created.push(this);
      }

      open(method: string, url: string, async = true): void {
        this.method = method;
        this.url = url;
        this.async = async;
      }

      setRequestHeader(name: string, value: string): void {
        this.headers[name.toLowerCase()] = value;
      }

      send(body: Document | XMLHttpRequestBodyInit | null): void {
        this.body = body instanceof FormData ? body : null;
        if (this.upload.onprogress) {
          this.upload.onprogress({
            lengthComputable: true,
            loaded: 1,
            total: 2
          } as ProgressEvent<EventTarget>);
        }
        this.onload?.();
      }
    }

    vi.stubGlobal("XMLHttpRequest", MockXHR);
    const onProgress = vi.fn();
    const file = new File(["a"], "a.txt", { type: "text/plain" });

    const response = await apiClient.uploadSessionFile("s1", {
      file,
      targetPath: "/tmp",
      conflictPolicy: "rename",
      onProgress
    });

    expect(response.results[0]?.status).toBe("SUCCESS");
    expect(onProgress).toHaveBeenCalled();
    expect(MockXHR.created[0]?.method).toBe("POST");
    expect(MockXHR.created[0]?.url).toBe("/term/api/sessions/s1/files/upload");
    expect(MockXHR.created[0]?.withCredentials).toBe(true);
  });

  it("requests copilot chats filtered by agent key and lastRunId", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockJsonResponse([])
    );

    await apiClient.listCopilotChats("s1", "terminal-helper", "run-9");
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/s1/copilot/chats?agentKey=terminal-helper&lastRunId=run-9");
  });

  it("streams copilot query SSE events", async () => {
    const payload = [
      "data: {\"type\":\"chat.start\",\"chatId\":\"chat-1\"}",
      "",
      "data: {\"type\":\"content.delta\",\"contentId\":\"msg-1\",\"delta\":\"Hello\"}",
      "",
      "data: [DONE]",
      ""
    ].join("\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      }
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream"
      }
    }));

    const onEvent = vi.fn();
    await apiClient.streamCopilotQuery("s1", {
      agentKey: "terminal-helper",
      chatId: null,
      message: "Inspect repository"
    }, { onEvent });

    expect(onEvent).toHaveBeenNthCalledWith(1, { type: "chat.start", chatId: "chat-1" });
    expect(onEvent).toHaveBeenNthCalledWith(2, { type: "content.delta", contentId: "msg-1", delta: "Hello" });
  });

  it("submits copilot tool results and executes reviewed commands", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockJsonResponse({
        accepted: true,
        status: "ok",
        runId: "run-1",
        toolId: "tool-1",
        detail: "accepted"
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        sessionId: "s1",
        command: "pwd",
        exitCode: 0,
        transcriptDelta: "/tmp/project\n",
        outputExcerpt: "/tmp/project\n",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:01Z"
      }));

    await apiClient.submitCopilotTool("s1", {
      runId: "run-1",
      toolId: "tool-1",
      params: { approved: true }
    });
    await apiClient.executeCopilotCommand("s1", {
      command: "pwd"
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/term/api/sessions/s1/copilot/submit");
    expect(fetchSpy.mock.calls[1]?.[0]).toBe("/term/api/sessions/s1/copilot/commands/execute");
  });
});
