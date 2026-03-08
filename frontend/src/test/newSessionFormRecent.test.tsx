import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewSessionForm } from "../react/features/session/NewSessionForm";
import { apiClient } from "../react/shared/api/client";
import type { CreateSessionRequest, SshCredentialSummaryResponse } from "../react/shared/api/types";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let queryClient: QueryClient | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function baseCredential(overrides: Partial<SshCredentialSummaryResponse> = {}): SshCredentialSummaryResponse {
  return {
    credentialId: "cred-1",
    title: null,
    host: "10.0.0.2",
    port: 22,
    username: "ubuntu",
    authType: "PASSWORD",
    createdAt: "2026-02-14T00:00:00Z",
    updatedAt: "2026-02-14T00:00:00Z",
    ...overrides
  };
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      },
      mutations: {
        retry: false
      }
    }
  });

  vi.spyOn(apiClient, "listTerminalClients").mockResolvedValue([]);
  vi.spyOn(apiClient, "listSshCredentials").mockResolvedValue([]);
  vi.spyOn(apiClient, "getWorkdirTree").mockResolvedValue({
    rootPath: "/tmp",
    currentPath: "/tmp",
    entries: []
  });
  vi.spyOn(apiClient, "listRecentSessions").mockResolvedValue([]);
  vi.spyOn(apiClient, "createSession").mockResolvedValue({
    sessionId: "s1",
    wsUrl: "/ws/s1",
    startedAt: "2026-02-14T00:00:00Z"
  });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
  container = null;
  queryClient?.clear();
  queryClient = null;
  vi.restoreAllMocks();
});

function render(onCreated = vi.fn()): ReturnType<typeof vi.fn> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <QueryClientProvider client={queryClient!}>
        <NewSessionForm onCreated={onCreated} variant="inline" />
      </QueryClientProvider>
    );
  });
  return onCreated;
}

describe("NewSessionForm recent + ssh title", () => {
  it("renders tool, recent and title in expected order", async () => {
    render();
    await flush();
    await flush();

    const ids = Array.from(
      container?.querySelectorAll("#new-session-tool, #new-session-recent, #new-session-title") || []
    ).map((item) => item.id);
    expect(ids).toEqual(["new-session-tool", "new-session-recent", "new-session-title"]);
  });

  it("applies recent terminal session and only creates after submit", async () => {
    const request: CreateSessionRequest = {
      sessionType: "LOCAL_PTY",
      toolId: "terminal",
      tabTitle: "dev shell",
      command: "/bin/bash",
      args: ["-l", "-i"],
      workdir: "/tmp/project"
    };
    vi.spyOn(apiClient, "listRecentSessions").mockResolvedValue([
      {
        toolId: "terminal",
        title: "dev shell",
        sessionType: "LOCAL_PTY",
        workdir: "/tmp/project",
        lastUsedAt: "2026-02-14T01:00:00Z",
        request
      }
    ]);

    const onCreated = render();
    await flush();
    await flush();

    const recentSelect = container?.querySelector("#new-session-recent") as HTMLSelectElement | null;
    expect(recentSelect).not.toBeNull();

    act(() => {
      if (!recentSelect) {
        return;
      }
      recentSelect.value = "0";
      recentSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(apiClient.createSession).toHaveBeenCalledTimes(0);
    expect((container?.querySelector("#new-session-title") as HTMLInputElement | null)?.value).toBe("dev shell");
    expect((container?.querySelector("#new-session-command") as HTMLInputElement | null)?.value).toBe("/bin/bash");
    expect((container?.querySelector("#new-session-args") as HTMLInputElement | null)?.value).toBe("-l -i");
    expect(container?.querySelector(".selected-workdir code")?.textContent).toBe("/tmp/project");

    const submitButton = container?.querySelector(".primary-btn") as HTMLButtonElement | null;
    expect(submitButton).not.toBeNull();
    act(() => {
      submitButton?.click();
    });
    await flush();

    expect(apiClient.createSession).toHaveBeenCalledWith(request);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({
      sessionId: "s1",
      title: "dev shell",
      toolId: "terminal",
      workdir: "/tmp/project"
    });
  });

  it("uses workdir as title when title input is empty", async () => {
    const onCreated = render();
    await flush();
    await flush();

    const titleInput = container?.querySelector("#new-session-title") as HTMLInputElement | null;
    expect(titleInput?.value).toBe("");

    const submitButton = container?.querySelector(".primary-btn") as HTMLButtonElement | null;
    expect(submitButton).not.toBeNull();
    act(() => {
      submitButton?.click();
    });
    await flush();

    expect(apiClient.createSession).toHaveBeenCalledWith({
      sessionType: "LOCAL_PTY",
      toolId: "terminal",
      tabTitle: "/tmp",
      command: "/bin/zsh",
      args: ["-l"],
      workdir: "/tmp"
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({
      title: "/tmp",
      workdir: "/tmp",
      toolId: "terminal"
    });
  });

  it("uses workdir as option label when recent title is empty", async () => {
    vi.spyOn(apiClient, "listRecentSessions").mockResolvedValue([
      {
        toolId: "terminal",
        title: "",
        sessionType: "LOCAL_PTY",
        workdir: "/srv/app",
        lastUsedAt: "2026-02-14T01:00:00Z",
        request: {}
      }
    ]);

    render();
    await flush();
    await flush();

    const recentSelect = container?.querySelector("#new-session-recent") as HTMLSelectElement | null;
    expect(recentSelect).not.toBeNull();
    const optionLabels = Array.from(recentSelect?.querySelectorAll("option") || []).map((item) => item.textContent || "");
    expect(optionLabels).toContain("/srv/app");
  });

  it("shows ssh title first and falls back to connection info", async () => {
    vi.spyOn(apiClient, "listSshCredentials").mockResolvedValue([
      baseCredential({ credentialId: "cred-1", title: "prod machine" }),
      baseCredential({ credentialId: "cred-2", title: null, host: "10.0.0.3" })
    ]);

    render();
    await flush();
    await flush();

    const toolSelect = container?.querySelector("#new-session-tool") as HTMLSelectElement | null;
    expect(toolSelect).not.toBeNull();

    act(() => {
      if (!toolSelect) {
        return;
      }
      toolSelect.value = "ssh";
      toolSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    await flush();

    const credentialSelect = container?.querySelector("#new-session-ssh-credential") as HTMLSelectElement | null;
    expect(credentialSelect).not.toBeNull();

    const labels = Array.from(credentialSelect?.querySelectorAll("option") || []).map((item) => item.textContent || "");
    expect(labels).toContain("prod machine");
    expect(labels).toContain("ubuntu@10.0.0.3:22 (PASSWORD)");
  });
});
