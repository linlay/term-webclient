import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "./shared/api/client";
import { LoginForm } from "./features/auth/LoginForm";
import { isUnauthorizedError, useAuthStatus, useLogout } from "./features/auth/useAuth";
import { NewSessionForm } from "./features/session/NewSessionForm";
import { TerminalPane } from "./features/terminal/TerminalPane";
import { useTabsStore } from "./features/tabs/useTabsStore";

function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting";
    case "disconnected":
      return "disconnected";
    case "error":
      return "error";
    case "exited":
      return "exited";
    default:
      return "idle";
  }
}

export default function App(): JSX.Element {
  const authQuery = useAuthStatus();
  const logout = useLogout();

  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const addTab = useTabsStore((state) => state.addTab);
  const removeTab = useTabsStore((state) => state.removeTab);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const setTabStatus = useTabsStore((state) => state.setTabStatus);

  const closeSession = useMutation({
    mutationFn: (sessionId: string) => apiClient.closeSession(sessionId)
  });

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.localId === activeTabId) ?? null,
    [activeTabId, tabs]
  );

  if (authQuery.isLoading) {
    return <div className="react-loading">Loading...</div>;
  }

  if (authQuery.isError) {
    if (isUnauthorizedError(authQuery.error)) {
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
  if (auth.enabled && !auth.authenticated) {
    return <LoginForm />;
  }

  return (
    <div className="react-app-shell">
      <header className="react-top-bar">
        <div>
          <h1>PTY Web Terminal (React Mode)</h1>
          <p>React/TypeScript migration mode. Use legacy mode for full Copilot/SSH/Catalog workflows.</p>
        </div>
        <div className="react-top-actions">
          <span className="react-username">{auth.username}</span>
          <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Logout
          </button>
        </div>
      </header>

      <section className="react-card">
        <h2>New Session</h2>
        <NewSessionForm
          onCreated={({ sessionId, wsUrl, title, clientId }) => {
            addTab({
              sessionId,
              wsUrl,
              title,
              clientId
            });
          }}
        />
      </section>

      <section className="react-card react-tabs-card">
        <div className="react-tabs-header">
          <h2>Tabs</h2>
          <span>{tabs.length} open</span>
        </div>

        {tabs.length === 0 ? (
          <div className="react-empty">No active tabs. Create one above.</div>
        ) : (
          <>
            <div className="react-tab-list">
              {tabs.map((tab) => (
                <div
                  key={tab.localId}
                  className={`react-tab-item ${tab.localId === activeTabId ? "active" : ""}`}
                >
                  <button type="button" onClick={() => setActiveTab(tab.localId)}>
                    {tab.title}
                  </button>
                  <span className={`status-pill ${tab.status}`}>{statusLabel(tab.status)}</span>
                  <button
                    type="button"
                    className="react-tab-close"
                    onClick={async () => {
                      try {
                        await closeSession.mutateAsync(tab.sessionId);
                      } catch {
                        // backend may already release the session
                      }
                      removeTab(tab.localId);
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            {activeTab && (
              <div className="react-terminal-wrapper">
                <TerminalPane
                  tab={activeTab}
                  onStatusChange={(status) => setTabStatus(activeTab.localId, status)}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
