import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "./shared/api/client";
import { isAppMode } from "./shared/config/env";
import {
  buildRouteSearch,
  parseRouteIntent,
  shouldSyncRouteSessionFromActive,
  writeRouteSearch,
  type RouteIntentPatch
} from "./shared/routing/routeIntent";
import { generateId } from "./shared/utils/id";
import { useViewportHeight } from "./shared/hooks/useViewportHeight";
import { useNotice } from "./shared/hooks/useNotice";
import { useCopilotState } from "./shared/hooks/useCopilotState";
import { useMobileScroll } from "./shared/hooks/useMobileScroll";
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
import type { NewSessionCreatedPayload } from "./features/session/NewSessionForm";
import type { TerminalTab } from "./features/tabs/useTabsStore";

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

  const [routeIntent, setRouteIntent] = useState(() => parseRouteIntent(window.location.search));
  const [isNewWindowOpen, setIsNewWindowOpen] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  const { notice, showNotice } = useNotice();

  useViewportHeight();

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.localId === activeTabId) ?? null,
    [activeTabId, tabs]
  );

  const copilot = useCopilotState({
    activeTab,
    senderMapRef,
    showNotice,
    setTabAgentRunId
  });
  const isCopilotOpen = copilot.isCopilotOpen;
  const setIsCopilotOpen = copilot.setIsCopilotOpen;

  const { showScrollBottomFab, mobileShortcutsExpanded, setMobileShortcutsExpanded } = useMobileScroll({
    isMobile,
    activeTabId,
    terminalHandleMapRef
  });

  const closeSession = useMutation({
    mutationFn: (sessionId: string) => apiClient.closeSession(sessionId)
  });

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

  const applyRoutePatch = useCallback((patch: RouteIntentPatch, mode: "replace" | "push" = "replace") => {
    const currentSearch = window.location.search;
    const nextSearch = buildRouteSearch(currentSearch, patch);
    if (nextSearch !== currentSearch) {
      writeRouteSearch(patch, mode);
    }
    setRouteIntent(parseRouteIntent(nextSearch));
    return nextSearch;
  }, []);

  const selectTabAndSyncRoute = useCallback((localId: string) => {
    const selectedTab = tabs.find((tab) => tab.localId === localId);
    if (!selectedTab) {
      return;
    }
    setActiveTab(localId);
    applyRoutePatch({ sessionId: selectedTab.sessionId }, "replace");
  }, [applyRoutePatch, setActiveTab, tabs]);

  const openNewWindowFromUi = useCallback(() => {
    applyRoutePatch({ openNewSession: true });
    setIsNewWindowOpen(true);
  }, [applyRoutePatch]);

  const closeNewWindow = useCallback(() => {
    applyRoutePatch({ openNewSession: null, openNonce: null });
    setIsNewWindowOpen(false);
  }, [applyRoutePatch]);

  const listSessionsQuery = useQuery({
    queryKey: ["sessions", authQuery.data?.authenticated, appMode],
    queryFn: () => apiClient.listSessions(),
    enabled: authQuery.data?.authenticated === true || appMode,
    refetchOnWindowFocus: false,
    refetchInterval: 2000
  });

  useEffect(() => {
    if (hydratedSessionsRef.current || !listSessionsQuery.data) {
      return;
    }
    const loaded = listSessionsQuery.data.map((item) => ({
      localId: generateId(),
      title: item.title,
      sessionId: item.sessionId,
      wsUrl: item.wsUrl,
      clientId: generateId(),
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
    const onPopState = () => {
      setRouteIntent(parseRouteIntent(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (!routeIntent.sessionId) {
      return;
    }
    const matchedTab = tabs.find((tab) => tab.sessionId === routeIntent.sessionId);
    if (!matchedTab) {
      return;
    }
    if (matchedTab.localId === activeTabId) {
      return;
    }
    setActiveTab(matchedTab.localId);
  }, [activeTabId, routeIntent.sessionId, setActiveTab, tabs]);

  useEffect(() => {
    setIsNewWindowOpen(routeIntent.openNewSession);
  }, [routeIntent.openNewSession]);

  useEffect(() => {
    const activeSessionId = activeTab?.sessionId;
    if (!activeSessionId) {
      return;
    }
    if (!shouldSyncRouteSessionFromActive(activeSessionId, routeIntent.sessionId, tabs.map((tab) => tab.sessionId))) {
      return;
    }
    applyRoutePatch({ sessionId: activeSessionId }, "replace");
  }, [activeTab?.sessionId, applyRoutePatch, routeIntent.sessionId, tabs]);

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
        closeNewWindow();
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
  }, [closeNewWindow, isCopilotOpen, isMobile, isNewWindowOpen, pendingCloseTabId, setIsCopilotOpen, tabContextMenu]);

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
        clientId: generateId(),
        createRequest: tab.createRequest
      });
      showNotice(`Rebuilt ${tab.title}`, "success", 2200);
    } catch (error) {
      setTabStatus(localId, "error");
      copilot.setAgentError(error instanceof Error ? error.message : "Failed to rebuild session");
      showNotice(error instanceof Error ? error.message : "Failed to rebuild session", "error", 3200);
    }
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
            onSelectTab={selectTabAndSyncRoute}
            onCloseTab={(tabId) => {
              requestCloseTab(tabId);
            }}
            onOpenNewWindow={openNewWindowFromUi}
            onOpenContextMenu={(payload: TabContextPayload) => {
              setTabContextMenu(payload);
            }}
          />

          <div className="top-actions">
            <button
              type="button"
              className="ghost-btn top-icon-btn copilot-toggle-btn"
              aria-label="Copilot"
              title="Copilot"
              onClick={() => {
                setIsCopilotOpen((prev) => !prev);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16" />
                <path d="M4 12h16" />
                <path d="M4 18h16" />
              </svg>
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
            open={copilot.isCopilotOpen}
            sideTab={copilot.sideTab}
            sessionId={activeTab?.sessionId ?? null}
            summaryLoading={copilot.summaryLoading}
            summaryError={copilot.summaryError}
            summaryContext={copilot.summaryContext}
            summaryScreenText={copilot.summaryScreenText}
            agentBusy={copilot.agentBusy}
            agentError={copilot.agentError}
            agentInstruction={copilot.agentInstruction}
            agentSelectedPaths={copilot.agentSelectedPaths}
            agentQuickCommand={copilot.agentQuickCommand}
            agentRun={copilot.agentRun}
            onTabChange={copilot.setSideTab}
            onRefreshSummary={() => {
              void copilot.refreshSummary();
            }}
            onCopySummaryContext={() => {
              void copyText(copilot.summaryContext, "Copied context JSON");
            }}
            onCopySummaryScreen={() => {
              void copyText(copilot.summaryScreenText, "Copied screen text");
            }}
            onAgentInstructionChange={copilot.setAgentInstruction}
            onAgentSelectedPathsChange={copilot.setAgentSelectedPaths}
            onAgentQuickCommandChange={copilot.setAgentQuickCommand}
            onStartAgentRun={() => {
              void copilot.startAgentRun();
            }}
            onRefreshAgentRun={() => {
              void copilot.refreshAgentRun();
            }}
            onApproveAgentRun={(confirmRisk) => {
              void copilot.approveAgentRun(confirmRisk);
            }}
            onAbortAgentRun={() => {
              void copilot.abortAgentRun();
            }}
            onSendQuickCommand={copilot.sendQuickCommand}
            onClose={() => setIsCopilotOpen(false)}
          />
        </div>
      </div>

      {isMobile && isCopilotOpen && (
        <div className="copilot-mobile-backdrop" aria-hidden="true" onClick={() => setIsCopilotOpen(false)} />
      )}

      {notice && <div className={`notice ${notice.type}`}>{notice.message}</div>}

      <NewWindowModal
        open={isNewWindowOpen}
        onClose={closeNewWindow}
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
          applyRoutePatch({
            sessionId: payload.sessionId,
            openNewSession: null,
            openNonce: null
          });
          setIsNewWindowOpen(false);
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
          selectTabAndSyncRoute(contextTab.localId);
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
