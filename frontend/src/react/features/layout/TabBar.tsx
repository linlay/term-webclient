import type { TerminalTab } from "../tabs/useTabsStore";

export interface TabContextPayload {
  tabId: string;
  x: number;
  y: number;
}

interface TabBarProps {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onOpenNewWindow: () => void;
  onOpenContextMenu: (payload: TabContextPayload) => void;
}

export function canRebuildTab(tab: TerminalTab): boolean {
  if (!tab.createRequest) {
    return false;
  }
  return tab.lost === true || tab.status === "disconnected" || tab.status === "error" || tab.status === "exited";
}

function buildTabTooltip(tab: TerminalTab): string {
  const lines = [
    `Session: ${tab.sessionId || "-"}`,
    `Connection: ${tab.lost && tab.status === "disconnected" ? "disconnected/lost" : tab.status}`,
    `Exit: ${tab.exitCode ?? "-"}`,
    `Tool: ${tab.toolId || "terminal"}`,
    `Type: ${tab.sessionType}`,
    `Workdir: ${tab.workdir || "."}`
  ];
  return lines.join("\n");
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onOpenNewWindow,
  onOpenContextMenu
}: TabBarProps): JSX.Element {
  return (
    <div className="tab-bar" data-testid="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.localId}
          className={`tab-item ${tab.localId === activeTabId ? "active" : ""}`}
          data-tab-id={tab.localId}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenContextMenu({
              tabId: tab.localId,
              x: event.clientX,
              y: event.clientY
            });
          }}
        >
          <button type="button" className="tab-main" title={buildTabTooltip(tab)} onClick={() => onSelectTab(tab.localId)}>
            <span className={`tab-dot ${tab.status}`} />
            <span className="tab-title">{tab.lost ? `${tab.title} [lost]` : tab.title}</span>
          </button>
          <button type="button" className="tab-close" title="Close tab" onClick={() => onCloseTab(tab.localId)}>
            x
          </button>
        </div>
      ))}
      <button type="button" className="tab-plus" title="New window" onClick={onOpenNewWindow} data-testid="tab-plus">
        +
      </button>
    </div>
  );
}
