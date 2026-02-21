import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TabBar, canRebuildTab } from "../react/features/layout/TabBar";
import { TabContextMenu } from "../react/features/layout/TabContextMenu";
import { CloseTabConfirmModal } from "../react/features/layout/CloseTabConfirmModal";
import type { TerminalTab } from "../react/features/tabs/useTabsStore";

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
    sshCredentialId: null,
    createRequest: null,
    agentRunId: null,
    lost: false,
    exitCode: "-",
    ...partial
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

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
});

function render(node: JSX.Element): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

describe("layout components", () => {
  it("checks rebuild availability", () => {
    expect(canRebuildTab(makeTab({ status: "disconnected", createRequest: { toolId: "terminal" } }))).toBe(true);
    expect(canRebuildTab(makeTab({ status: "error", createRequest: { toolId: "terminal" } }))).toBe(true);
    expect(canRebuildTab(makeTab({ status: "exited", createRequest: { toolId: "terminal" } }))).toBe(true);
    expect(canRebuildTab(makeTab({ lost: true, createRequest: { toolId: "terminal" } }))).toBe(true);
    expect(canRebuildTab(makeTab({ status: "connected", createRequest: { toolId: "terminal" } }))).toBe(false);
    expect(canRebuildTab(makeTab({ status: "disconnected", createRequest: null }))).toBe(false);
  });

  it("opens new window from + button and opens tab context menu", () => {
    const onOpenNewWindow = vi.fn();
    const onOpenContextMenu = vi.fn();

    render(
      <TabBar
        tabs={[makeTab()]}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onOpenNewWindow={onOpenNewWindow}
        onOpenContextMenu={onOpenContextMenu}
      />
    );

    const plusButton = container?.querySelector("[data-testid='tab-plus']");
    expect(plusButton).not.toBeNull();

    act(() => {
      plusButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenNewWindow).toHaveBeenCalledTimes(1);

    const tabItem = container?.querySelector(".tab-item");
    expect(tabItem).not.toBeNull();
    act(() => {
      tabItem?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 120, clientY: 88 }));
    });
    expect(onOpenContextMenu).toHaveBeenCalledTimes(1);
    expect(onOpenContextMenu.mock.calls[0]?.[0]).toMatchObject({ tabId: "tab-1", x: 120, y: 88 });
  });

  it("renders tab context menu open/close actions", () => {
    const onRebuild = vi.fn();
    const onCloseTab = vi.fn();

    render(
      <TabContextMenu
        state={{ tabId: "tab-1", x: 10, y: 20 }}
        rebuildDisabled={true}
        menuRef={{ current: null }}
        onRebuild={onRebuild}
        onCloseTab={onCloseTab}
      />
    );

    const menu = container?.querySelector("[data-testid='tab-context-menu']");
    expect(menu).not.toBeNull();

    const buttons = container?.querySelectorAll("button") ?? [];
    expect(buttons.length).toBe(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onRebuild).toHaveBeenCalledTimes(0);
  });

  it("CloseTabConfirmModal renders nothing when closed", () => {
    render(
      <CloseTabConfirmModal open={false} tabTitle="test" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    const modal = container?.querySelector("[data-testid='close-tab-confirm-modal']");
    expect(modal).toBeNull();
  });

  it("CloseTabConfirmModal renders with tab title and triggers callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <CloseTabConfirmModal open={true} tabTitle="my-session" onConfirm={onConfirm} onCancel={onCancel} />
    );

    const modal = container?.querySelector("[data-testid='close-tab-confirm-modal']");
    expect(modal).not.toBeNull();

    const text = container?.querySelector(".close-tab-confirm-text");
    expect(text?.textContent).toContain("my-session");

    const buttons = container?.querySelectorAll(".modal-actions button") ?? [];
    expect(buttons.length).toBe(2);

    // Cancel button
    act(() => {
      (buttons[0] as HTMLButtonElement).click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Confirm button
    act(() => {
      (buttons[1] as HTMLButtonElement).click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
