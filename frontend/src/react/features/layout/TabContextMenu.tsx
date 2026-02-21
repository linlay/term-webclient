import type { Ref } from "react";

export interface TabContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

interface TabContextMenuProps {
  state: TabContextMenuState | null;
  rebuildDisabled: boolean;
  menuRef: Ref<HTMLDivElement>;
  onRebuild: () => void;
  onCloseTab: () => void;
}

export function TabContextMenu({
  state,
  rebuildDisabled,
  menuRef,
  onRebuild,
  onCloseTab
}: TabContextMenuProps): JSX.Element | null {
  if (!state) {
    return null;
  }

  const style = {
    left: `${Math.max(8, state.x)}px`,
    top: `${Math.max(8, state.y)}px`
  };

  return (
    <div ref={menuRef} className="context-menu" role="menu" style={style} data-testid="tab-context-menu">
      <button type="button" role="menuitem" disabled={rebuildDisabled} onClick={onRebuild}>
        Rebuild Session
      </button>
      <button type="button" role="menuitem" onClick={onCloseTab}>
        Close Tab
      </button>
    </div>
  );
}
