import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CopilotSidebar } from "../react/features/layout/CopilotSidebar";
import { MobileTabManagerSheet, MobileTabSwitcher } from "../react/features/layout/MobileTabSwitcher";
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
    fileRootPath: ".",
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

  it("renders mobile tab switcher with select, manage, and add actions", () => {
    const onSelectTab = vi.fn();
    const onOpenManager = vi.fn();
    const onOpenNewWindow = vi.fn();

    render(
      <MobileTabSwitcher
        tabs={[makeTab(), makeTab({ localId: "tab-2", title: "ssh", sessionId: "s2" })]}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onOpenManager={onOpenManager}
        onOpenNewWindow={onOpenNewWindow}
      />
    );

    const select = container?.querySelector("[data-testid='mobile-tab-select']") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.options).toHaveLength(2);

    act(() => {
      if (select) {
        select.value = "tab-2";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(onSelectTab).toHaveBeenCalledWith("tab-2");

    act(() => {
      (container?.querySelector("[data-testid='mobile-tab-manager-btn']") as HTMLButtonElement).click();
      (container?.querySelector("[data-testid='mobile-tab-plus']") as HTMLButtonElement).click();
    });
    expect(onOpenManager).toHaveBeenCalledTimes(1);
    expect(onOpenNewWindow).toHaveBeenCalledTimes(1);
  });

  it("renders mobile tab manager sheet for switching and closing tabs", () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onClose = vi.fn();

    render(
      <MobileTabManagerSheet
        open={true}
        tabs={[makeTab(), makeTab({ localId: "tab-2", title: "ssh", sessionId: "s2" })]}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onClose={onClose}
      />
    );

    const mainButtons = container?.querySelectorAll(".mobile-tab-main") ?? [];
    expect(mainButtons.length).toBe(2);

    act(() => {
      (mainButtons[1] as HTMLButtonElement).click();
    });
    expect(onSelectTab).toHaveBeenCalledWith("tab-2");
    expect(onClose).toHaveBeenCalledTimes(1);

    const closeButtons = container?.querySelectorAll(".mobile-tab-close-btn") ?? [];
    act(() => {
      (closeButtons[0] as HTMLButtonElement).click();
    });
    expect(onCloseTab).toHaveBeenCalledWith("tab-1");
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

  it("renders Copilot sidebar as mobile sheet with assist tab", () => {
    const onInsertAssistCommand = vi.fn();
    const onExecuteAssistCommand = vi.fn();
    render(
      <CopilotSidebar
        open={true}
        isMobile={true}
        sideTab="assist"
        sessionId="s1"
        summaryLoading={false}
        summaryError=""
        summaryContext=""
        summaryScreenText="git status"
        assistQuestion="How to inspect?"
        assistSuggestions={[{
          id: "git-status-short",
          command: "git status --short",
          reason: "Check repo state."
        }]}
        assistCapturedScreenText="modified: app.tsx"
        assistCapturedChars={17}
        assistBusy={false}
        assistError=""
        onTabChange={vi.fn()}
        onRefreshSummary={vi.fn()}
        onCopySummaryContext={vi.fn()}
        onCopySummaryScreen={vi.fn()}
        onAssistQuestionChange={vi.fn()}
        onGenerateAssistSuggestions={vi.fn()}
        onInsertAssistCommand={onInsertAssistCommand}
        onExecuteAssistCommand={onExecuteAssistCommand}
        onClose={vi.fn()}
      />
    );

    const sidebar = container?.querySelector("[data-testid='copilot-sidebar']");
    expect(sidebar).toHaveClass("mobile-sheet");
    expect(container?.textContent).toContain("Assist");
    expect(container?.textContent).toContain("git status --short");
    expect(container?.textContent).not.toContain("Agent");
    expect(container?.querySelector("[data-testid='assist-screen-text']")).toBeNull();

    act(() => {
      (container?.querySelector("[data-testid='assist-screen-toggle']") as HTMLButtonElement).click();
    });
    expect(container?.querySelector("[data-testid='assist-screen-text']")).not.toBeNull();

    const actionButtons = container?.querySelectorAll(".assist-suggestion-actions button") ?? [];
    expect(actionButtons.length).toBe(2);
    act(() => {
      (actionButtons[0] as HTMLButtonElement).click();
      (actionButtons[1] as HTMLButtonElement).click();
    });
    expect(onInsertAssistCommand).toHaveBeenCalledWith("git status --short");
    expect(onExecuteAssistCommand).toHaveBeenCalledWith("git status --short");
  });
});
