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

  it("renders mobile tab switcher as a single trigger", () => {
    const onOpenSheet = vi.fn();

    render(
      <MobileTabSwitcher
        tabs={[makeTab(), makeTab({ localId: "tab-2", title: "ssh", sessionId: "s2" })]}
        activeTabId="tab-1"
        onOpenSheet={onOpenSheet}
      />
    );

    const select = container?.querySelector("[data-testid='mobile-tab-select']") as HTMLButtonElement | null;
    expect(select).not.toBeNull();
    expect(select?.textContent).toContain("terminal [connected]");
    expect(container?.querySelector("[data-testid='mobile-tab-manager-btn']")).toBeNull();
    expect(container?.querySelector("[data-testid='mobile-tab-plus']")).toBeNull();

    act(() => {
      select?.click();
    });
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
  });

  it("renders mobile tab manager sheet for switching, adding and closing tabs", () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onOpenNewWindow = vi.fn();
    const onClose = vi.fn();

    render(
      <MobileTabManagerSheet
        open={true}
        tabs={[makeTab(), makeTab({ localId: "tab-2", title: "ssh", sessionId: "s2" })]}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onOpenNewWindow={onOpenNewWindow}
        onClose={onClose}
      />
    );

    const addButton = Array.from(container?.querySelectorAll(".mobile-tab-sheet-head button") ?? []).find(
      (button) => button.textContent === "新增"
    ) as HTMLButtonElement | undefined;
    expect(addButton).toBeDefined();

    act(() => {
      addButton?.click();
    });
    expect(onOpenNewWindow).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    const mainButtons = container?.querySelectorAll(".mobile-tab-main") ?? [];
    expect(mainButtons.length).toBe(2);

    act(() => {
      (mainButtons[1] as HTMLButtonElement).click();
    });
    expect(onSelectTab).toHaveBeenCalledWith("tab-2");
    expect(onClose).toHaveBeenCalledTimes(2);

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

  it("renders Copilot sidebar as mobile sheet with builtin assist agent", () => {
    const onGenerateAssistSuggestions = vi.fn();
    const onClearAssistQuestion = vi.fn();
    const onCopyAssistCommand = vi.fn();
    const onInsertAssistCommand = vi.fn();
    const onExecuteAssistCommand = vi.fn();
    render(
      <CopilotSidebar
        open={true}
        isMobile={true}
        sideTab="agent"
        sessionId="s1"
        summaryLoading={false}
        summaryError=""
        summaryContext=""
        summaryScreenText="git status"
        agents={[{
          key: "default-assist",
          label: "Default Assist",
          description: "Local suggestions",
          type: "builtin_assist",
          default: true
        }]}
        selectedAgentKey="default-assist"
        selectedAgent={{
          key: "default-assist",
          label: "Default Assist",
          description: "Local suggestions",
          type: "builtin_assist",
          default: true
        }}
        assistQuestion="How to inspect?"
        assistSuggestions={[{
          id: "git-status-short",
          command: "git status --short",
          reason: "Check repo state.",
          weight: 92
        }]}
        assistCapturedScreenText="modified: app.tsx"
        assistCapturedChars={17}
        assistBusy={false}
        assistError=""
        runnerPrompt=""
        runnerBusy={false}
        runnerError=""
        runnerHistoryBusy={false}
        runnerHistory={[]}
        runnerChatId={null}
        runnerConversation={[]}
        runnerPlan={[]}
        runnerPendingReview={null}
        runnerCanRun={true}
        runnerCapabilityMessage="Runner agents require a shell or SSH terminal tab."
        onTabChange={vi.fn()}
        onRefreshSummary={vi.fn()}
        onCopySummaryContext={vi.fn()}
        onCopySummaryScreen={vi.fn()}
        onSelectAgent={vi.fn()}
        onAssistQuestionChange={vi.fn()}
        onGenerateAssistSuggestions={onGenerateAssistSuggestions}
        onClearAssistQuestion={onClearAssistQuestion}
        onCopyAssistCommand={onCopyAssistCommand}
        onInsertAssistCommand={onInsertAssistCommand}
        onExecuteAssistCommand={onExecuteAssistCommand}
        onRunnerPromptChange={vi.fn()}
        onRefreshRunnerHistory={vi.fn()}
        onSendRunnerMessage={vi.fn()}
        onNewRunnerChat={vi.fn()}
        onOpenRunnerChat={vi.fn()}
        onApproveNextReviewCommand={vi.fn()}
        onApproveAllReviewCommands={vi.fn()}
        onRejectReviewCommands={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const sidebar = container?.querySelector("[data-testid='copilot-sidebar']");
    expect(sidebar).toHaveClass("mobile-sheet");
    expect(container?.textContent).toContain("Agent");
    expect(container?.textContent).toContain("git status --short");
    expect(container?.textContent).toContain("Weight 92");
    expect(container?.querySelector("[data-testid='assist-screen-text']")).toBeNull();
    expect((container?.querySelector("#assistQuestionInput") as HTMLTextAreaElement | null)?.rows).toBe(2);

    act(() => {
      (container?.querySelector("[data-testid='assist-screen-toggle']") as HTMLButtonElement).click();
    });
    expect(container?.querySelector("[data-testid='assist-screen-text']")).not.toBeNull();

    act(() => {
      const question = container?.querySelector("#assistQuestionInput");
      question?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const event = new KeyboardEvent("keydown", { bubbles: true, key: "Enter" });
      Object.defineProperty(event, "isComposing", { value: true });
      question?.dispatchEvent(event);
      question?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(onGenerateAssistSuggestions).toHaveBeenCalledTimes(0);

    const actionButtons = container?.querySelectorAll(".assist-suggestion-actions button") ?? [];
    expect(actionButtons.length).toBe(3);

    act(() => {
      (Array.from(container?.querySelectorAll(".agent-actions-row button") ?? []).find(
        (button) => button.textContent === "清空"
      ) as HTMLButtonElement | undefined)?.click();
      (actionButtons[0] as HTMLButtonElement).click();
      (actionButtons[1] as HTMLButtonElement).click();
      (actionButtons[2] as HTMLButtonElement).click();
    });
    expect(onClearAssistQuestion).toHaveBeenCalledTimes(1);
    expect(onCopyAssistCommand).toHaveBeenCalledWith("git status --short");
    expect(onInsertAssistCommand).toHaveBeenCalledWith("git status --short");
    expect(onExecuteAssistCommand).toHaveBeenCalledWith("git status --short");
  });

  it("renders runner agent history and terminal review actions", () => {
    const onNewRunnerChat = vi.fn();
    const onOpenRunnerChat = vi.fn();
    const onApproveNextReviewCommand = vi.fn();
    const onApproveAllReviewCommands = vi.fn();
    const onRejectReviewCommands = vi.fn();

    render(
      <CopilotSidebar
        open={true}
        isMobile={false}
        sideTab="agent"
        sessionId="s1"
        summaryLoading={false}
        summaryError=""
        summaryContext=""
        summaryScreenText=""
        agents={[{
          key: "terminal-helper",
          label: "Terminal Helper",
          description: "Runner assistant",
          type: "runner_agent",
          default: false
        }]}
        selectedAgentKey="terminal-helper"
        selectedAgent={{
          key: "terminal-helper",
          label: "Terminal Helper",
          description: "Runner assistant",
          type: "runner_agent",
          default: false
        }}
        assistQuestion=""
        assistSuggestions={[]}
        assistCapturedScreenText=""
        assistCapturedChars={0}
        assistBusy={false}
        assistError=""
        runnerPrompt="Inspect repo"
        runnerBusy={false}
        runnerError=""
        runnerHistoryBusy={false}
        runnerHistory={[{
          chatId: "chat-1",
          chatName: "Chat 1",
          agentKey: "terminal-helper",
          createdAt: 1,
          updatedAt: 2,
          lastRunId: "run-1",
          lastRunContent: "Inspect repository",
          readStatus: 1,
          readAt: null
        }]}
        runnerChatId="chat-1"
        runnerConversation={[
          { id: "user-1", role: "user", text: "Inspect repository" },
          { id: "assistant-1", role: "assistant", text: "Plan ready." }
        ]}
        runnerPlan={[
          { taskId: "t1", title: "Inspect repo", status: "in_progress" }
        ]}
        runnerPendingReview={{
          runId: "run-1",
          toolId: "tool-1",
          title: "Review commands",
          summary: "Need approval before execution.",
          allowBatchApprove: true,
          submitting: false,
          commands: [{
            id: "cmd-1",
            title: "Inspect repo",
            command: "pwd",
            reason: "Check workdir",
            highRisk: false,
            status: "pending",
            exitCode: null,
            outputExcerpt: "",
            transcriptDelta: "",
            error: null,
            startedAt: null,
            completedAt: null
          }]
        }}
        runnerCanRun={true}
        runnerCapabilityMessage="Runner agents require a shell or SSH terminal tab."
        onTabChange={vi.fn()}
        onRefreshSummary={vi.fn()}
        onCopySummaryContext={vi.fn()}
        onCopySummaryScreen={vi.fn()}
        onSelectAgent={vi.fn()}
        onAssistQuestionChange={vi.fn()}
        onGenerateAssistSuggestions={vi.fn()}
        onClearAssistQuestion={vi.fn()}
        onCopyAssistCommand={vi.fn()}
        onInsertAssistCommand={vi.fn()}
        onExecuteAssistCommand={vi.fn()}
        onRunnerPromptChange={vi.fn()}
        onRefreshRunnerHistory={vi.fn()}
        onSendRunnerMessage={vi.fn()}
        onNewRunnerChat={onNewRunnerChat}
        onOpenRunnerChat={onOpenRunnerChat}
        onApproveNextReviewCommand={onApproveNextReviewCommand}
        onApproveAllReviewCommands={onApproveAllReviewCommands}
        onRejectReviewCommands={onRejectReviewCommands}
        onClose={vi.fn()}
      />
    );

    expect(container?.textContent).toContain("Chat History");
    expect(container?.textContent).toContain("Inspect repository");
    expect(container?.textContent).toContain("Plan ready.");
    expect(container?.textContent).toContain("Approve All");

    act(() => {
      (container?.querySelector("[data-testid='runner-new-chat']") as HTMLButtonElement).click();
      (container?.querySelector(".runner-history-item") as HTMLButtonElement).click();
      (container?.querySelector("[data-testid='runner-approve-next']") as HTMLButtonElement).click();
      (container?.querySelector("[data-testid='runner-approve-all']") as HTMLButtonElement).click();
      (container?.querySelector("[data-testid='runner-reject']") as HTMLButtonElement).click();
    });

    expect(onNewRunnerChat).toHaveBeenCalledTimes(1);
    expect(onOpenRunnerChat).toHaveBeenCalledWith("chat-1");
    expect(onApproveNextReviewCommand).toHaveBeenCalledTimes(1);
    expect(onApproveAllReviewCommands).toHaveBeenCalledTimes(1);
    expect(onRejectReviewCommands).toHaveBeenCalledTimes(1);
  });
});
