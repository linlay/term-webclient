import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "./shared/api/client";
import { COPILOT_REFRESH_MS, isAppMode } from "./shared/config/env";
import { parseQuickCommand } from "./shared/terminal/quickCommand";
import { LoginForm } from "./features/auth/LoginForm";
import { isUnauthorizedError, useAuthStatus, useLogout } from "./features/auth/useAuth";
import { TerminalPane, type TerminalPaneHandle } from "./features/terminal/TerminalPane";
import { useTabsStore } from "./features/tabs/useTabsStore";
import { CopilotSidebar } from "./features/layout/CopilotSidebar";
import { MobileShortcutBar } from "./features/layout/MobileShortcutBar";
import { NewWindowModal } from "./features/layout/NewWindowModal";
import { TabBar, canRebuildTab, type TabContextPayload } from "./features/layout/TabBar";
import { TabContextMenu, type TabContextMenuState } from "./features/layout/TabContextMenu";
import { CloseTabConfirmModal } from "./features/layout/CloseTabConfirmModal";
import type { AgentRunResponse } from "./shared/api/types";
import type { NewSessionCreatedPayload } from "./features/session/NewSessionForm";
import type { TerminalTab } from "./features/tabs/useTabsStore";

interface NoticeState {
  message: string;
  type: "info" | "warn" | "error" | "success";
}

function randomClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseSelectedPaths(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isMobileViewport(): boolean {
  return window.innerWidth <= 900;
}

export default function App(): JSX.Element {
  const appMode = isAppMode();
  const authQuery = useAuthStatus();
  const logout = useLogout();

  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const addTab = useTabsStore((state) => state.addTab);
  const removeTab = useTabsStore((state) => state.removeTab);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const setTabs = useTabsStore((state) => state.setTabs);
  const setTabStatus = useTabsStore((state) => state.setTabStatus);
  const setTabAgentRunId = useTabsStore((state) => state.setTabAgentRunId);
  const setTabLost = useTabsStore((state) => state.setTabLost);
  const setTabExitCode = useTabsStore((state) => state.setTabExitCode);
  const replaceTabSession = useTabsStore((state) => state.replaceTabSession);

  const senderMapRef = useRef(new Map<string, (data: string) => boolean>());
  const terminalHandleMapRef = useRef(new Map<string, TerminalPaneHandle>());
  const hydratedSessionsRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const [sideTab, setSideTab] = useState<"summary" | "agent">("summary");
  const [summaryContext, setSummaryContext] = useState("");
  const [summaryScreenText, setSummaryScreenText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentSelectedPaths, setAgentSelectedPaths] = useState("");
  const [agentQuickCommand, setAgentQuickCommand] = useState("");
  const [agentRun, setAgentRun] = useState<AgentRunResponse | null>(null);
  const [agentError, setAgentError] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  const [isNewWindowOpen, setIsNewWindowOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [mobileShortcutsExpanded, setMobileShortcutsExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  const [showScrollBottomFab, setShowScrollBottomFab] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  const closeSession = useMutation({
    mutationFn: (sessionId: string) => apiClient.closeSession(sessionId)
  });

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.localId === activeTabId) ?? null,
    [activeTabId, tabs]
  );

  const contextTab = useMemo(
    () => (tabContextMenu ? tabs.find((tab) => tab.localId === tabContextMenu.tabId) ?? null : null),
    [tabContextMenu, tabs]
  );

  const handleTabStatusChange = useCallback((localId: string, status: "connecting" | "connected" | "disconnected" | "exited" | "error") => {
    setTabStatus(localId, status);
  }, [setTabStatus]);

  const handleTabLostChange = useCallback((localId: string, lost: boolean) => {
    setTabLost(localId, lost);
  }, [setTabLost]);

  const handleTabExitCodeChange = useCallback((localId: string, exitCode: string) => {
    setTabExitCode(localId, exitCode);
  }, [setTabExitCode]);

  const handleRegisterInputSender = useCallback((localId: string, sender: ((data: string) => boolean) | null) => {
    if (!sender) {
      senderMapRef.current.delete(localId);
      return;
    }
    senderMapRef.current.set(localId, sender);
  }, []);

  const handleTerminalReady = useCallback((localId: string, handle: TerminalPaneHandle | null) => {
    if (!handle) {
      terminalHandleMapRef.current.delete(localId);
      return;
    }
    terminalHandleMapRef.current.set(localId, handle);
  }, []);

  const listSessionsQuery = useQuery({
    queryKey: ["sessions", authQuery.data?.authenticated, appMode],
    queryFn: () => apiClient.listSessions(),
    enabled: authQuery.data?.authenticated === true || appMode,
    refetchOnWindowFocus: false,
    refetchInterval: 2000
  });

  function showNotice(message: string, type: NoticeState["type"] = "info", timeoutMs = 2600): void {
    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice({ message, type });
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, timeoutMs);
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hydratedSessionsRef.current || !listSessionsQuery.data) {
      return;
    }
    const loaded = listSessionsQuery.data.map((item) => ({
      localId: randomClientId(),
      title: item.title,
      sessionId: item.sessionId,
      wsUrl: item.wsUrl,
      clientId: randomClientId(),
      status: "connecting" as const,
      createdAt: item.startedAt,
      sessionType: item.sessionType,
      toolId: item.toolId,
      workdir: item.workdir,
      sshCredentialId: null,
      createRequest: null,
      agentRunId: null,
      lost: item.connectionState === "lost",
      exitCode: "-"
    }));
    setTabs(loaded);
    hydratedSessionsRef.current = true;
  }, [listSessionsQuery.data, setTabs]);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(isMobileViewport());
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let settleTimer: number | null = null;
    let longSettleTimer: number | null = null;
    const updateViewportVars = (useSafeMax = false) => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport ? Math.max(0, viewport.height) : window.innerHeight;
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const keyboardInset = viewport ? Math.max(0, layoutHeight - viewportHeight - viewport.offsetTop) : 0;

      const effectiveHeight = useSafeMax && keyboardInset < 10
        ? Math.max(viewportHeight, window.innerHeight)
        : viewportHeight;

      root.style.setProperty("--app-vh", `${Math.round(effectiveHeight)}px`);
      root.style.setProperty("--mobile-shortcut-inset", `${Math.round(keyboardInset)}px`);
    };
    const scheduleSettledViewportUpdate = () => {
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        updateViewportVars();
      }, 150);
    };
    const handleViewportChange = () => {
      updateViewportVars();
      scheduleSettledViewportUpdate();
    };
    const handleFocusOut = () => {
      scheduleSettledViewportUpdate();
      if (longSettleTimer != null) {
        window.clearTimeout(longSettleTimer);
      }
      longSettleTimer = window.setTimeout(() => {
        longSettleTimer = null;
        updateViewportVars(true);
      }, 400);
    };

    updateViewportVars();

    const viewport = window.visualViewport;
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.addEventListener("pageshow", handleViewportChange);
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);
    document.addEventListener("focusin", scheduleSettledViewportUpdate, true);
    document.addEventListener("focusout", handleFocusOut, true);

    return () => {
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
      }
      if (longSettleTimer != null) {
        window.clearTimeout(longSettleTimer);
      }
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.removeEventListener("pageshow", handleViewportChange);
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      document.removeEventListener("focusin", scheduleSettledViewportUpdate, true);
      document.removeEventListener("focusout", handleFocusOut, true);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!isMobile) {
      root.style.setProperty("--mobile-shortcut-bar-offset", "0px");
      return;
    }
    root.style.setProperty("--mobile-shortcut-bar-offset", mobileShortcutsExpanded ? "72px" : "42px");
  }, [isMobile, mobileShortcutsExpanded]);

  useEffect(() => {
    if (!tabContextMenu) {
      return;
    }

    const onClickOutside = (event: MouseEvent) => {
      const menu = contextMenuRef.current;
      if (!menu) {
        setTabContextMenu(null);
        return;
      }
      if (event.target instanceof Node && menu.contains(event.target)) {
        return;
      }
      setTabContextMenu(null);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTabContextMenu(null);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onEscape);
    };
  }, [tabContextMenu]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (pendingCloseTabId) {
        cancelCloseTab();
        return;
      }
      if (tabContextMenu) {
        setTabContextMenu(null);
        return;
      }
      if (isNewWindowOpen) {
        setIsNewWindowOpen(false);
        return;
      }
      if (isMobile && isCopilotOpen) {
        setIsCopilotOpen(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [isCopilotOpen, isMobile, isNewWindowOpen, pendingCloseTabId, tabContextMenu]);

  useEffect(() => {
    if (!isMobile || !activeTabId) {
      setShowScrollBottomFab(false);
      return;
    }

    const updateVisibility = () => {
      const handle = terminalHandleMapRef.current.get(activeTabId);
      if (!handle) {
        setShowScrollBottomFab(false);
        return;
      }
      setShowScrollBottomFab(!handle.isNearBottom());
    };

    updateVisibility();
    const timer = window.setInterval(updateVisibility, 150);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeTabId, isMobile]);

  async function refreshSummary(): Promise<void> {
    if (!activeTab?.sessionId) {
      setSummaryContext("");
      setSummaryScreenText("");
      setSummaryError("No active tab");
      return;
    }
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const [context, screen] = await Promise.all([
        apiClient.getSessionContext(activeTab.sessionId),
        apiClient.getSessionScreenText(activeTab.sessionId)
      ]);
      setSummaryContext(JSON.stringify(context, null, 2));
      setSummaryScreenText(screen.text || "");
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Failed to load summary");
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (sideTab !== "summary" || !isCopilotOpen) {
      return;
    }
    void refreshSummary();
    const timer = window.setInterval(() => {
      void refreshSummary();
    }, COPILOT_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideTab, activeTab?.sessionId, isCopilotOpen]);

  async function refreshAgentRun(): Promise<void> {
    if (!activeTab?.sessionId || !activeTab.agentRunId) {
      setAgentRun(null);
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.getAgentRun(activeTab.sessionId, activeTab.agentRunId);
      setAgentRun(run);
      setTabAgentRunId(activeTab.localId, run.runId);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to refresh agent run");
    } finally {
      setAgentBusy(false);
    }
  }

  useEffect(() => {
    if (sideTab !== "agent" || !isCopilotOpen) {
      return;
    }
    void refreshAgentRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideTab, activeTab?.sessionId, activeTab?.agentRunId, isCopilotOpen]);

  async function copyText(value: string, successNotice: string): Promise<void> {
    if (!value.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showNotice(successNotice, "success", 1800);
    } catch {
      showNotice("Copy failed in this browser context", "warn", 2400);
    }
  }

  async function closeTab(localId: string): Promise<void> {
    const tab = tabs.find((item) => item.localId === localId);
    if (!tab) {
      return;
    }
    try {
      await closeSession.mutateAsync(tab.sessionId);
    } catch {
      // backend may already close this session
    }
    senderMapRef.current.delete(localId);
    terminalHandleMapRef.current.delete(localId);
    removeTab(localId);
  }

  function isTabSessionActive(tab: TerminalTab): boolean {
    return (tab.status === "connecting" || tab.status === "connected") && !tab.lost;
  }

  function requestCloseTab(localId: string): void {
    const tab = tabs.find((item) => item.localId === localId);
    if (!tab) {
      return;
    }
    if (isTabSessionActive(tab)) {
      setPendingCloseTabId(localId);
    } else {
      void closeTab(localId);
    }
  }

  function confirmCloseTab(): void {
    if (pendingCloseTabId) {
      void closeTab(pendingCloseTabId);
    }
    setPendingCloseTabId(null);
  }

  function cancelCloseTab(): void {
    setPendingCloseTabId(null);
  }

  async function rebuildTab(localId: string): Promise<void> {
    const tab = tabs.find((item) => item.localId === localId);
    if (!tab || !tab.createRequest) {
      showNotice("Rebuild unavailable for restored tab", "warn", 2800);
      return;
    }

    setTabStatus(localId, "connecting");
    setTabLost(localId, false);
    setTabExitCode(localId, "-");

    try {
      const response = await apiClient.createSession(tab.createRequest);
      try {
        await apiClient.closeSession(tab.sessionId);
      } catch {
        // ignore old session close failure
      }
      replaceTabSession(localId, {
        sessionId: response.sessionId,
        wsUrl: response.wsUrl,
        clientId: randomClientId(),
        createRequest: tab.createRequest
      });
      showNotice(`Rebuilt ${tab.title}`, "success", 2200);
    } catch (error) {
      setTabStatus(localId, "error");
      setAgentError(error instanceof Error ? error.message : "Failed to rebuild session");
      showNotice(error instanceof Error ? error.message : "Failed to rebuild session", "error", 3200);
    }
  }

  async function startAgentRun(): Promise<void> {
    if (!activeTab?.sessionId) {
      setAgentError("No active tab");
      return;
    }
    const instruction = agentInstruction.trim();
    if (!instruction) {
      setAgentError("Instruction is required");
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.createAgentRun(activeTab.sessionId, {
        instruction,
        selectedPaths: parseSelectedPaths(agentSelectedPaths),
        includeGitDiff: true
      });
      setAgentRun(run);
      setTabAgentRunId(activeTab.localId, run.runId);
      showNotice(`Agent run created: ${run.runId}`, "success", 2200);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to create agent run");
    } finally {
      setAgentBusy(false);
    }
  }

  async function approveAgentRun(confirmRisk: boolean): Promise<void> {
    if (!activeTab?.sessionId || !activeTab.agentRunId) {
      setAgentError("No active run for current tab");
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.approveAgentRun(activeTab.sessionId, activeTab.agentRunId, { confirmRisk });
      setAgentRun(run);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to approve run");
    } finally {
      setAgentBusy(false);
    }
  }

  async function abortAgentRun(): Promise<void> {
    if (!activeTab?.sessionId || !activeTab.agentRunId) {
      setAgentError("No active run for current tab");
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.abortAgentRun(activeTab.sessionId, activeTab.agentRunId, { reason: "manual abort" });
      setAgentRun(run);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to abort run");
    } finally {
      setAgentBusy(false);
    }
  }

  function sendQuickCommand(): void {
    if (!activeTab) {
      setAgentError("No active tab");
      return;
    }
    const payload = parseQuickCommand(agentQuickCommand);
    if (!payload) {
      setAgentError("Quick command is empty");
      return;
    }
    const sender = senderMapRef.current.get(activeTab.localId);
    if (!sender) {
      setAgentError("Active terminal is not ready");
      return;
    }
    const ok = sender(payload);
    if (!ok) {
      setAgentError("Active terminal websocket is not connected");
      return;
    }
    setAgentQuickCommand("");
    setAgentError("");
  }

  function sendMobileShortcut(sequence: string): void {
    if (!activeTab) {
      showNotice("No active tab", "warn");
      return;
    }
    const sender = senderMapRef.current.get(activeTab.localId);
    if (!sender) {
      showNotice("Active terminal is not ready", "warn");
      return;
    }
    const ok = sender(sequence);
    if (!ok) {
      showNotice("Terminal is not connected", "warn");
      return;
    }
    terminalHandleMapRef.current.get(activeTab.localId)?.focus();
  }

  async function pasteToActiveTerminal(): Promise<void> {
    if (!activeTab) {
      showNotice("No active tab", "warn");
      return;
    }
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error("Clipboard API unavailable");
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }
      const sender = senderMapRef.current.get(activeTab.localId);
      if (!sender || !sender(text)) {
        showNotice("Terminal is not connected", "warn");
        return;
      }
      terminalHandleMapRef.current.get(activeTab.localId)?.focus();
    } catch {
      showNotice("Paste failed in this browser context", "warn");
    }
  }

  if (authQuery.isLoading) {
    return <div className="react-loading">Loading...</div>;
  }

  if (authQuery.isError) {
    if (isUnauthorizedError(authQuery.error)) {
      if (appMode) {
        return <div className="react-loading">Waiting for app access token...</div>;
      }
      return <LoginForm />;
    }
    return (
      <div className="react-loading react-error">
        Failed to load auth status: {authQuery.error instanceof Error ? authQuery.error.message : "unknown error"}
      </div>
    );
  }

  const auth = authQuery.data;
  if (!auth) {
    return <div className="react-loading">Loading...</div>;
  }
  if (!appMode && auth.enabled && !auth.authenticated) {
    return <LoginForm />;
  }

  return (
    <>
      <div className="layout">
        <div className="top-row">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTab}
            onCloseTab={(tabId) => {
              requestCloseTab(tabId);
            }}
            onOpenNewWindow={() => {
              setIsNewWindowOpen(true);
            }}
            onOpenContextMenu={(payload: TabContextPayload) => {
              setTabContextMenu(payload);
            }}
          />

          <div className="top-actions">
            <button
              type="button"
              className="ghost-btn top-icon-btn"
              aria-label="Copilot"
              title="Copilot"
              onClick={() => {
                setIsCopilotOpen((prev) => !prev);
              }}
            >
              *
            </button>
            {!appMode && (
              <button
                type="button"
                className="ghost-btn top-icon-btn"
                aria-label="Logout"
                title="Logout"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {listSessionsQuery.isError && (
          <div className="notice warn">
            Failed to load existing sessions: {listSessionsQuery.error instanceof Error ? listSessionsQuery.error.message : "unknown error"}
          </div>
        )}

        <div className="main-content">
          <main className={`terminal-area ${mobileShortcutsExpanded ? "mobile-shortcuts-expanded" : ""}`}>
            <div className={`empty-state ${tabs.length > 0 ? "hidden" : ""}`}>
              No windows. Click + to create one.
            </div>

            {tabs.map((tab) => (
              <div key={tab.localId} className={`terminal-panel ${tab.localId === activeTabId ? "" : "hidden"}`}>
                <TerminalPane
                  tab={tab}
                  isActive={tab.localId === activeTabId}
                  onStatusChange={handleTabStatusChange}
                  onLostChange={handleTabLostChange}
                  onExitCodeChange={handleTabExitCodeChange}
                  onRegisterInputSender={handleRegisterInputSender}
                  onTerminalReady={handleTerminalReady}
                />
              </div>
            ))}

            {isMobile && (
              <>
                <MobileShortcutBar
                  sessionType={activeTab?.sessionType ?? null}
                  toolId={activeTab?.toolId ?? null}
                  expanded={mobileShortcutsExpanded}
                  onToggle={() => setMobileShortcutsExpanded((prev) => !prev)}
                  onCollapse={() => setMobileShortcutsExpanded(false)}
                  onSend={sendMobileShortcut}
                  onPaste={() => {
                    void pasteToActiveTerminal();
                  }}
                />
                <button
                  type="button"
                  className={`scroll-bottom-fab ${showScrollBottomFab ? "visible" : ""}`}
                  onClick={() => {
                    if (!activeTab) {
                      return;
                    }
                    const handle = terminalHandleMapRef.current.get(activeTab.localId);
                    if (!handle) {
                      return;
                    }
                    handle.scrollToBottom();
                    handle.focus();
                  }}
                >
                  到底部
                </button>
              </>
            )}
          </main>

          <CopilotSidebar
            open={isCopilotOpen}
            sideTab={sideTab}
            sessionId={activeTab?.sessionId ?? null}
            summaryLoading={summaryLoading}
            summaryError={summaryError}
            summaryContext={summaryContext}
            summaryScreenText={summaryScreenText}
            agentBusy={agentBusy}
            agentError={agentError}
            agentInstruction={agentInstruction}
            agentSelectedPaths={agentSelectedPaths}
            agentQuickCommand={agentQuickCommand}
            agentRun={agentRun}
            onTabChange={setSideTab}
            onRefreshSummary={() => {
              void refreshSummary();
            }}
            onCopySummaryContext={() => {
              void copyText(summaryContext, "Copied context JSON");
            }}
            onCopySummaryScreen={() => {
              void copyText(summaryScreenText, "Copied screen text");
            }}
            onAgentInstructionChange={setAgentInstruction}
            onAgentSelectedPathsChange={setAgentSelectedPaths}
            onAgentQuickCommandChange={setAgentQuickCommand}
            onStartAgentRun={() => {
              void startAgentRun();
            }}
            onRefreshAgentRun={() => {
              void refreshAgentRun();
            }}
            onApproveAgentRun={(confirmRisk) => {
              void approveAgentRun(confirmRisk);
            }}
            onAbortAgentRun={() => {
              void abortAgentRun();
            }}
            onSendQuickCommand={sendQuickCommand}
          />
        </div>
      </div>

      {isMobile && isCopilotOpen && (
        <div className="copilot-mobile-backdrop" aria-hidden="true" onClick={() => setIsCopilotOpen(false)} />
      )}

      {notice && <div className={`notice ${notice.type}`}>{notice.message}</div>}

      <NewWindowModal
        open={isNewWindowOpen}
        onClose={() => setIsNewWindowOpen(false)}
        onCreated={(payload: NewSessionCreatedPayload) => {
          addTab({
            sessionId: payload.sessionId,
            wsUrl: payload.wsUrl,
            title: payload.title,
            clientId: payload.clientId,
            sessionType: payload.sessionType,
            toolId: payload.toolId,
            workdir: payload.workdir,
            sshCredentialId: payload.sshCredentialId,
            createRequest: payload.createRequest
          });
        }}
      />

      <TabContextMenu
        state={tabContextMenu}
        menuRef={contextMenuRef}
        rebuildDisabled={!contextTab || !canRebuildTab(contextTab)}
        onRebuild={() => {
          if (!contextTab) {
            setTabContextMenu(null);
            return;
          }
          setTabContextMenu(null);
          setActiveTab(contextTab.localId);
          void rebuildTab(contextTab.localId);
        }}
        onCloseTab={() => {
          if (!contextTab) {
            setTabContextMenu(null);
            return;
          }
          setTabContextMenu(null);
          requestCloseTab(contextTab.localId);
        }}
      />

      <CloseTabConfirmModal
        open={pendingCloseTabId !== null}
        tabTitle={tabs.find((t) => t.localId === pendingCloseTabId)?.title ?? ""}
        onConfirm={confirmCloseTab}
        onCancel={cancelCloseTab}
      />
    </>
  );
}
