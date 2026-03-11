import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "./shared/api/client";
import { isAppMode } from "./shared/config/env";
import { useViewportHeight } from "./shared/hooks/useViewportHeight";
import { useNotice } from "./shared/hooks/useNotice";
import { useCopilotState } from "./shared/hooks/useCopilotState";
import { useMobileScroll } from "./shared/hooks/useMobileScroll";
import { useRouteSync } from "./shared/hooks/useRouteSync";
import { useTabManager } from "./shared/hooks/useTabManager";
import { applyThemeMode, persistThemeMode, resolveThemeMode, type ThemeMode } from "./shared/theme/theme";
import { normalizeToolId, isShellCapableTab } from "./shared/utils/toolId";
import { generateId } from "./shared/utils/id";
import { LoginForm } from "./features/auth/LoginForm";
import { isUnauthorizedError, useAuthStatus, useLogout } from "./features/auth/useAuth";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { useTabsStore } from "./features/tabs/useTabsStore";
import { CopilotSidebar } from "./features/layout/CopilotSidebar";
import { MobileShortcutBar } from "./features/layout/MobileShortcutBar";
import { MobileTabManagerSheet, MobileTabSwitcher } from "./features/layout/MobileTabSwitcher";
import { NewWindowModal } from "./features/layout/NewWindowModal";
import { TabBar, canRebuildTab, type TabContextPayload } from "./features/layout/TabBar";
import { TabContextMenu, type TabContextMenuState } from "./features/layout/TabContextMenu";
import { CloseTabConfirmModal } from "./features/layout/CloseTabConfirmModal";
import { FileSidebar } from "./features/files/FileSidebar";
import { MobileFileSheet } from "./features/files/MobileFileSheet";
import type { NewSessionCreatedPayload } from "./features/session/NewSessionForm";
import type { TerminalTab } from "./features/tabs/useTabsStore";

function isMobileViewport(): boolean {
  return window.innerWidth <= 900;
}

function canUseFilesForTab(tab: TerminalTab | null): boolean {
  if (!tab) {
    return false;
  }
  const toolId = normalizeToolId(tab.toolId);
  if (
    toolId === "codex" ||
    toolId === "claude" ||
    toolId === "claude code" ||
    toolId === "claude-code" ||
    toolId === "claude_code"
  ) {
    return false;
  }
  return isShellCapableTab(tab);
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
  const setTabLost = useTabsStore((state) => state.setTabLost);
  const setTabExitCode = useTabsStore((state) => state.setTabExitCode);
  const replaceTabSession = useTabsStore((state) => state.replaceTabSession);

  const hydratedSessionsRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [isMobile, setIsMobile] = useState(() => isMobileViewport());
  const [mobileTabManagerOpen, setMobileTabManagerOpen] = useState(false);
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
  const [desktopFilesOpen, setDesktopFilesOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => resolveThemeMode());

  const { notice, showNotice } = useNotice();

  useViewportHeight();

  useEffect(() => {
    applyThemeMode(themeMode);
    persistThemeMode(themeMode);
  }, [themeMode]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.localId === activeTabId) ?? null,
    [activeTabId, tabs]
  );
  const canUseFiles = useMemo(() => canUseFilesForTab(activeTab), [activeTab]);

  const closeSession = useMutation({
    mutationFn: (sessionId: string) => apiClient.closeSession(sessionId)
  });

  const tabManager = useTabManager({
    tabs,
    activeTab,
    removeTab,
    replaceTabSession,
    setTabStatus,
    setTabLost,
    setTabExitCode,
    closeSession: (sessionId) => closeSession.mutateAsync(sessionId),
    showNotice
  });

  const routeSync = useRouteSync({
    tabs,
    activeTabId,
    setActiveTab
  });

  const copilot = useCopilotState({
    activeTab,
    senderMapRef: tabManager.senderMapRef,
    focusTerminal: tabManager.focusTerminal,
    showNotice
  });
  const isCopilotOpen = copilot.isCopilotOpen;
  const setIsCopilotOpen = copilot.setIsCopilotOpen;

  const { showScrollBottomFab, mobileShortcutsExpanded, setMobileShortcutsExpanded } = useMobileScroll({
    isMobile,
    activeTabId,
    terminalHandleMapRef: tabManager.terminalHandleMapRef
  });

  const contextTab = useMemo(
    () => (tabContextMenu ? tabs.find((tab) => tab.localId === tabContextMenu.tabId) ?? null : null),
    [tabContextMenu, tabs]
  );

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
      fileRootPath: item.fileRootPath || item.workdir,
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
    if (!isMobile && mobileTabManagerOpen) {
      setMobileTabManagerOpen(false);
    }
  }, [isMobile, mobileTabManagerOpen]);

  useEffect(() => {
    if (!activeTab && mobileFilesOpen) {
      setMobileFilesOpen(false);
    }
    if (!activeTab || canUseFiles) {
      return;
    }
    if (mobileFilesOpen) {
      setMobileFilesOpen(false);
    }
    if (desktopFilesOpen) {
      setDesktopFilesOpen(false);
    }
  }, [activeTab, canUseFiles, desktopFilesOpen, mobileFilesOpen]);

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
      if (tabManager.pendingCloseTabId) {
        tabManager.cancelCloseTab();
        return;
      }
      if (tabContextMenu) {
        setTabContextMenu(null);
        return;
      }
      if (routeSync.isNewWindowOpen) {
        routeSync.closeNewWindow();
        return;
      }
      if (mobileTabManagerOpen) {
        setMobileTabManagerOpen(false);
        return;
      }
      if (mobileFilesOpen) {
        setMobileFilesOpen(false);
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
  }, [
    isCopilotOpen,
    isMobile,
    mobileFilesOpen,
    mobileTabManagerOpen,
    routeSync,
    setIsCopilotOpen,
    tabContextMenu,
    tabManager
  ]);

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
          {isMobile ? (
            <MobileTabSwitcher
              tabs={tabs}
              activeTabId={activeTabId}
              onOpenSheet={() => setMobileTabManagerOpen(true)}
            />
          ) : (
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelectTab={routeSync.selectTabAndSyncRoute}
              onCloseTab={tabManager.requestCloseTab}
              onOpenNewWindow={routeSync.openNewWindowFromUi}
              onOpenContextMenu={(payload: TabContextPayload) => {
                setTabContextMenu(payload);
              }}
            />
          )}

          <div className="top-actions">
            <button
              type="button"
              className="ghost-btn top-icon-btn theme-toggle-btn"
              aria-label={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              data-testid="theme-toggle"
              onClick={() => {
                setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
              }}
            >
              {themeMode === "dark" ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2" />
                  <path d="M12 20v2" />
                  <path d="m4.93 4.93 1.41 1.41" />
                  <path d="m17.66 17.66 1.41 1.41" />
                  <path d="M2 12h2" />
                  <path d="M20 12h2" />
                  <path d="m6.34 17.66-1.41 1.41" />
                  <path d="m19.07 4.93-1.41 1.41" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a6 6 0 1 0 9 9 9 9 0 1 1-9-9" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className={`ghost-btn top-icon-btn files-toggle-btn ${desktopFilesOpen && !isMobile ? "active" : ""}`}
              aria-label="Files"
              title="Files"
              onClick={() => {
                if (isMobile) {
                  setMobileFilesOpen(true);
                  return;
                }
                setDesktopFilesOpen((prev) => !prev);
              }}
              disabled={!activeTab || !canUseFiles}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
            </button>
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
                  themeMode={themeMode}
                  onStatusChange={tabManager.handleTabStatusChange}
                  onLostChange={tabManager.handleTabLostChange}
                  onExitCodeChange={tabManager.handleTabExitCodeChange}
                  onRegisterInputSender={tabManager.handleRegisterInputSender}
                  onTerminalReady={tabManager.handleTerminalReady}
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
                  onSend={tabManager.sendMobileShortcut}
                  onPaste={() => {
                    void tabManager.pasteToActiveTerminal();
                  }}
                />
                <button
                  type="button"
                  className={`scroll-bottom-fab ${showScrollBottomFab ? "visible" : ""}`}
                  onClick={() => {
                    if (!activeTab) {
                      return;
                    }
                    const handle = tabManager.terminalHandleMapRef.current.get(activeTab.localId);
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

          {!isMobile && activeTab && canUseFiles && desktopFilesOpen && (
            <FileSidebar
              sessionId={activeTab.sessionId}
              fileRootPath={activeTab.fileRootPath || activeTab.workdir}
              onNotice={showNotice}
            />
          )}

          <CopilotSidebar
            open={copilot.isCopilotOpen}
            isMobile={isMobile}
            sideTab={copilot.sideTab}
            sessionId={activeTab?.sessionId ?? null}
            agents={copilot.agents}
            selectedAgentKey={copilot.selectedAgentKey}
            selectedAgent={copilot.selectedAgent}
            summary={{
              loading: copilot.summaryLoading,
              error: copilot.summaryError,
              context: copilot.summaryContext,
              screenText: copilot.summaryScreenText,
              onRefresh: () => {
                void copilot.refreshSummary();
              },
              onCopyContext: () => {
                void copyText(copilot.summaryContext, "Copied context JSON");
              },
              onCopyScreen: () => {
                void copyText(copilot.summaryScreenText, "Copied screen text");
              }
            }}
            assist={{
              sessionId: activeTab?.sessionId ?? null,
              selectedAgentKey: copilot.selectedAgentKey,
              question: copilot.assistQuestion,
              suggestions: copilot.assistSuggestions,
              capturedScreenText: copilot.assistCapturedScreenText,
              capturedChars: copilot.assistCapturedChars,
              busy: copilot.assistBusy,
              error: copilot.assistError,
              hasLastSubmittedQuestion: Boolean(copilot.lastSubmittedAssistQuestion),
              onQuestionChange: copilot.setAssistQuestion,
              onGenerateSuggestions: () => {
                void copilot.generateAssistSuggestions();
              },
              onClearQuestion: copilot.clearAssistQuestion,
              onRestoreLastQuestion: copilot.restoreLastAssistQuestion,
              onCopyCommand: (command) => {
                void copilot.copyAssistCommand(command);
              },
              onInsertCommand: copilot.insertAssistCommand,
              onExecuteCommand: copilot.executeAssistCommand
            }}
            runner={{
              selectedAgent: copilot.selectedAgent,
              prompt: copilot.runnerPrompt,
              busy: copilot.runnerBusy,
              error: copilot.runnerError,
              historyBusy: copilot.runnerHistoryBusy,
              history: copilot.runnerHistory,
              chatId: copilot.runnerChatId,
              conversation: copilot.runnerConversation,
              plan: copilot.runnerPlan,
              pendingReview: copilot.runnerPendingReview,
              canRun: copilot.runnerCanRun,
              capabilityMessage: copilot.runnerCapabilityMessage,
              onPromptChange: copilot.setRunnerPrompt,
              onRefreshHistory: () => {
                void copilot.refreshRunnerHistory();
              },
              onSendMessage: () => {
                void copilot.sendRunnerMessage();
              },
              onNewChat: copilot.startNewRunnerChat,
              onOpenChat: (chatId) => {
                void copilot.openRunnerChat(chatId);
              },
              onApproveNext: () => {
                void copilot.approveNextReviewCommand();
              },
              onApproveAll: () => {
                void copilot.approveAllReviewCommands();
              },
              onReject: () => {
                void copilot.rejectReviewCommands();
              }
            }}
            onTabChange={copilot.setSideTab}
            onSelectAgent={copilot.selectAgent}
            onClose={() => setIsCopilotOpen(false)}
          />
        </div>
      </div>

      {isMobile && isCopilotOpen && (
        <div className="copilot-mobile-backdrop" aria-hidden="true" onClick={() => setIsCopilotOpen(false)} />
      )}

      {isMobile && (
        <MobileTabManagerSheet
          open={mobileTabManagerOpen}
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={routeSync.selectTabAndSyncRoute}
          onCloseTab={tabManager.requestCloseTab}
          onOpenNewWindow={routeSync.openNewWindowFromUi}
          onClose={() => setMobileTabManagerOpen(false)}
        />
      )}

      {isMobile && activeTab && canUseFiles && (
        <MobileFileSheet
          open={mobileFilesOpen}
          sessionId={activeTab.sessionId}
          fileRootPath={activeTab.fileRootPath || activeTab.workdir}
          onClose={() => setMobileFilesOpen(false)}
          onNotice={showNotice}
        />
      )}

      {notice && <div className={`notice ${notice.type}`}>{notice.message}</div>}

      <NewWindowModal
        open={routeSync.isNewWindowOpen}
        onClose={routeSync.closeNewWindow}
        onCreated={(payload: NewSessionCreatedPayload) => {
          addTab({
            sessionId: payload.sessionId,
            wsUrl: payload.wsUrl,
            title: payload.title,
            clientId: payload.clientId,
            sessionType: payload.sessionType,
            toolId: payload.toolId,
            workdir: payload.workdir,
            fileRootPath: payload.fileRootPath || payload.workdir,
            sshCredentialId: payload.sshCredentialId,
            createRequest: payload.createRequest
          });
          routeSync.applyRoutePatch({
            sessionId: payload.sessionId,
            openNewSession: null,
            openNonce: null
          });
          routeSync.setIsNewWindowOpen(false);
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
          routeSync.selectTabAndSyncRoute(contextTab.localId);
          void tabManager.rebuildTab(contextTab.localId);
        }}
        onCloseTab={() => {
          if (!contextTab) {
            setTabContextMenu(null);
            return;
          }
          setTabContextMenu(null);
          tabManager.requestCloseTab(contextTab.localId);
        }}
      />

      <CloseTabConfirmModal
        open={tabManager.pendingCloseTabId !== null}
        tabTitle={tabs.find((t) => t.localId === tabManager.pendingCloseTabId)?.title ?? ""}
        onConfirm={tabManager.confirmCloseTab}
        onCancel={tabManager.cancelCloseTab}
      />
    </>
  );
}
