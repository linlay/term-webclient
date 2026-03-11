import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useRouteSync } from "../react/shared/hooks/useRouteSync";
import { useTabManager } from "../react/shared/hooks/useTabManager";
import { apiClient } from "../react/shared/api/client";
import type { TerminalTab } from "../react/features/tabs/useTabsStore";
import type { TerminalPaneHandle } from "../react/features/terminal/TerminalPane";

function makeTab(partial: Partial<TerminalTab> = {}): TerminalTab {
  return {
    localId: "tab-1",
    title: "terminal",
    sessionId: "s1",
    wsUrl: "/ws/s1",
    clientId: "client-1",
    status: "connected",
    createdAt: "2026-01-01T00:00:00Z",
    sessionType: "LOCAL_PTY",
    toolId: "terminal",
    workdir: ".",
    fileRootPath: ".",
    sshCredentialId: null,
    createRequest: { sessionType: "LOCAL_PTY", toolId: "terminal", command: "/bin/zsh", args: [] },
    agentRunId: null,
    lost: false,
    exitCode: "-",
    ...partial
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
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
});

function render(node: JSX.Element): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

function flushPromises(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

describe("app hooks", () => {
  it("useRouteSync syncs selected tabs and new-session route state", () => {
    let hook: ReturnType<typeof useRouteSync> | null = null;
    const getHook = (): ReturnType<typeof useRouteSync> => {
      if (!hook) {
        throw new Error("route hook not ready");
      }
      return hook;
    };
    const setActiveTab = vi.fn();
    const tabs = [makeTab(), makeTab({ localId: "tab-2", sessionId: "s2", title: "ssh", toolId: "ssh" })];

    function Harness(): JSX.Element | null {
      hook = useRouteSync({ tabs, activeTabId: "tab-1", setActiveTab });
      return null;
    }

    render(<Harness />);

    act(() => {
      getHook().selectTabAndSyncRoute("tab-2");
    });
    expect(setActiveTab).toHaveBeenCalledWith("tab-2");
    expect(window.location.search).toContain("sessionId=s2");

    act(() => {
      getHook().openNewWindowFromUi();
    });
    expect(window.location.search).toContain("openNewSession=1");
    expect(getHook().isNewWindowOpen).toBe(true);

    act(() => {
      getHook().closeNewWindow();
    });
    expect(window.location.search).not.toContain("openNewSession=1");
    expect(getHook().isNewWindowOpen).toBe(false);
  });

  it("useRouteSync reacts to popstate session changes", () => {
    let hook: ReturnType<typeof useRouteSync> | null = null;
    const getHook = (): ReturnType<typeof useRouteSync> => {
      if (!hook) {
        throw new Error("route hook not ready");
      }
      return hook;
    };
    const setActiveTab = vi.fn();
    const tabs = [makeTab(), makeTab({ localId: "tab-2", sessionId: "s2" })];
    window.history.replaceState({}, "", "/?sessionId=s1");

    function Harness(): JSX.Element | null {
      hook = useRouteSync({ tabs, activeTabId: "tab-1", setActiveTab });
      return null;
    }

    render(<Harness />);
    expect(getHook().routeIntent.sessionId).toBe("s1");

    act(() => {
      window.history.pushState({}, "", "/?sessionId=s2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(setActiveTab).toHaveBeenCalledWith("tab-2");
    expect(getHook().routeIntent.sessionId).toBe("s2");
  });

  it("useTabManager gates close confirmation, rebuild, and mobile terminal actions", async () => {
    let hook: ReturnType<typeof useTabManager> | null = null;
    const getHook = (): ReturnType<typeof useTabManager> => {
      if (!hook) {
        throw new Error("tab hook not ready");
      }
      return hook;
    };
    const removeTab = vi.fn();
    const replaceTabSession = vi.fn();
    const setTabStatus = vi.fn();
    const setTabLost = vi.fn();
    const setTabExitCode = vi.fn();
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const showNotice = vi.fn();
    const focus = vi.fn();
    const scrollToBottom = vi.fn();
    const sender = vi.fn().mockReturnValue(true);
    const handle: TerminalPaneHandle = {
      focus,
      scrollToBottom,
      isNearBottom: () => false
    };
    const tabs = [makeTab()];

    vi.spyOn(apiClient, "createSession").mockResolvedValue({
      sessionId: "s2",
      wsUrl: "/ws/s2",
      startedAt: "2026-01-01T00:00:01Z"
    });
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        readText: vi.fn().mockResolvedValue("pwd")
      }
    });

    function Harness(): JSX.Element | null {
      hook = useTabManager({
        tabs,
        activeTab: tabs[0],
        removeTab,
        replaceTabSession,
        setTabStatus,
        setTabLost,
        setTabExitCode,
        closeSession,
        showNotice
      });
      return null;
    }

    render(<Harness />);

    act(() => {
      getHook().requestCloseTab("tab-1");
    });
    expect(getHook().pendingCloseTabId).toBe("tab-1");

    await act(async () => {
      getHook().confirmCloseTab();
      await flushPromises();
    });
    expect(closeSession).toHaveBeenCalledWith("s1");
    expect(removeTab).toHaveBeenCalledWith("tab-1");

    act(() => {
      getHook().handleRegisterInputSender("tab-1", sender);
      getHook().handleTerminalReady("tab-1", handle);
      getHook().sendMobileShortcut("\u0003");
    });
    expect(sender).toHaveBeenCalledWith("\u0003");
    expect(focus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await getHook().pasteToActiveTerminal();
    });
    expect(sender).toHaveBeenCalledWith("pwd");
    expect(focus).toHaveBeenCalledTimes(2);

    await act(async () => {
      await getHook().rebuildTab("tab-1");
      await flushPromises();
    });
    expect(apiClient.createSession).toHaveBeenCalledWith(tabs[0]?.createRequest);
    expect(replaceTabSession).toHaveBeenCalledWith("tab-1", expect.objectContaining({
      sessionId: "s2",
      wsUrl: "/ws/s2"
    }));
    expect(showNotice).toHaveBeenCalledWith("Rebuilt terminal", "success", 2200);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
