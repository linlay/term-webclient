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
});
