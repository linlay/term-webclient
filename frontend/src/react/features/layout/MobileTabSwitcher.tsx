import type { ChangeEvent } from "react";
import type { TerminalTab } from "../tabs/useTabsStore";

interface MobileTabSwitcherProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onOpenManager: () => void;
  onOpenNewWindow: () => void;
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

function handleSelectChange(event: ChangeEvent<HTMLSelectElement>, onSelectTab: (tabId: string) => void): void {
  const value = event.target.value;
  if (!value) {
    return;
  }
  onSelectTab(value);
}

export function MobileTabSwitcher({
  tabs,
  activeTabId,
  onSelectTab,
  onOpenManager,
  onOpenNewWindow
}: MobileTabSwitcherProps): JSX.Element {
  return (
    <div className="mobile-tab-switcher" data-testid="mobile-tab-switcher">
      <select
        className="mobile-tab-select"
        aria-label="Select session tab"
        data-testid="mobile-tab-select"
        value={activeTabId ?? ""}
        onChange={(event) => handleSelectChange(event, onSelectTab)}
        disabled={tabs.length === 0}
      >
        {tabs.length === 0 ? (
          <option value="">No windows</option>
        ) : (
          tabs.map((tab) => (
            <option key={tab.localId} value={tab.localId}>
              {formatTabLabel(tab)}
            </option>
          ))
        )}
      </select>
      <button
        type="button"
        className="ghost-btn mobile-tab-manager-btn"
        data-testid="mobile-tab-manager-btn"
        onClick={onOpenManager}
      >
        管理
      </button>
      <button
        type="button"
        className="mobile-tab-plus"
        title="New window"
        data-testid="mobile-tab-plus"
        onClick={onOpenNewWindow}
      >
        +
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
          <button type="button" className="ghost-btn" onClick={onClose}>关闭</button>
        </div>

        <div className="mobile-tab-sheet-toolbar">
          <button
            type="button"
            className="primary-btn"
            onClick={() => {
              onOpenNewWindow();
              onClose();
            }}
          >
            新建窗口
          </button>
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
