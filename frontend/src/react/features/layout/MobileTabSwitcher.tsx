import type { TerminalTab } from "../tabs/useTabsStore";

interface MobileTabSwitcherProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onOpenSheet: () => void;
}

interface MobileTabManagerSheetProps {
  open: boolean;
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenNewWindow: () => void;
  onClose: () => void;
}

function formatTabLabel(tab: TerminalTab): string {
  const state = tab.lost ? "lost" : tab.status;
  return `${tab.title} [${state}]`;
}

function getActiveTabLabel(tabs: TerminalTab[], activeTabId: string | null): string {
  const activeTab = tabs.find((tab) => tab.localId === activeTabId) ?? tabs[0] ?? null;
  if (!activeTab) {
    return "No windows";
  }
  return formatTabLabel(activeTab);
}

export function MobileTabSwitcher({
  tabs,
  activeTabId,
  onOpenSheet
}: MobileTabSwitcherProps): JSX.Element {
  return (
    <div className="mobile-tab-switcher" data-testid="mobile-tab-switcher">
      <button
        type="button"
        className="mobile-tab-select"
        aria-label="Open session manager"
        data-testid="mobile-tab-select"
        onClick={onOpenSheet}
      >
        <span className="mobile-tab-select-label">{getActiveTabLabel(tabs, activeTabId)}</span>
        <span className="mobile-tab-select-caret" aria-hidden="true">v</span>
      </button>
    </div>
  );
}

export function MobileTabManagerSheet({
  open,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onOpenNewWindow,
  onClose
}: MobileTabManagerSheetProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="mobile-tab-sheet-wrap">
      <div className="mobile-tab-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="mobile-tab-sheet" role="dialog" aria-label="Tab manager">
        <div className="mobile-tab-sheet-head">
          <div className="mobile-tab-sheet-title">会话管理</div>
          <div className="mobile-tab-sheet-head-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                onClose();
                onOpenNewWindow();
              }}
            >
              新增
            </button>
            <button type="button" className="ghost-btn" onClick={onClose}>关闭</button>
          </div>
        </div>

        <div className="mobile-tab-sheet-list">
          {tabs.length === 0 ? (
            <div className="file-empty">No windows</div>
          ) : (
            tabs.map((tab) => (
              <div key={tab.localId} className={`mobile-tab-item ${tab.localId === activeTabId ? "active" : ""}`}>
                <button
                  type="button"
                  className="mobile-tab-main"
                  onClick={() => {
                    onSelectTab(tab.localId);
                    onClose();
                  }}
                >
                  <span className={`tab-dot ${tab.status}`} />
                  <span className="mobile-tab-copy">
                    <span className="mobile-tab-name">{tab.lost ? `${tab.title} [lost]` : tab.title}</span>
                    <span className="mobile-tab-meta">{tab.sessionId}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="ghost-btn mobile-tab-close-btn"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => {
                    onCloseTab(tab.localId);
                    onClose();
                  }}
                >
                  关闭
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
