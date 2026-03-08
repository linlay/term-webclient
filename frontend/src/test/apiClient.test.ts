import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "../react/shared/api/client";

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
});
