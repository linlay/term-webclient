import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RefObject } from "react";
import { useCopilotState } from "../react/shared/hooks/useCopilotState";
import type { TerminalTab } from "../react/features/tabs/useTabsStore";

const apiClientMock = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  getSessionScreenText: vi.fn(),
  createAssistSuggestions: vi.fn(),
  listCopilotAgents: vi.fn(),
  listCopilotChats: vi.fn(),
  getCopilotChat: vi.fn(),
  streamCopilotQuery: vi.fn(),
  submitCopilotTool: vi.fn(),
  executeCopilotCommand: vi.fn()
}));

const clipboardWriteText = vi.fn();

vi.mock("../react/shared/api/client", () => ({
  apiClient: apiClientMock
}));

function makeTab(partial: Partial<TerminalTab> = {}): TerminalTab {
  return {
    localId: "tab-1",
    title: "terminal",
    sessionId: "s1",
    wsUrl: "/ws/s1",
    clientId: "c1",
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

interface HarnessProps {
  activeTab: TerminalTab | null;
  senderMapRef: RefObject<Map<string, (data: string) => boolean>>;
  focusTerminal: (localId: string) => void;
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
}

function Harness({ activeTab, senderMapRef, focusTerminal, showNotice }: HarnessProps): JSX.Element {
  const copilot = useCopilotState({
    activeTab,
    senderMapRef,
    focusTerminal,
    showNotice
  });

  return (
    <div>
      <select
        data-testid="agent-select"
        value={copilot.selectedAgentKey}
        onChange={(event) => copilot.selectAgent(event.target.value)}
      >
        <option value="">none</option>
        {copilot.agents.map((agent) => (
          <option key={agent.key} value={agent.key}>
            {agent.label}
          </option>
        ))}
      </select>
      <div data-testid="selected-agent">{copilot.selectedAgent?.type || ""}</div>

      <textarea
        data-testid="question"
        value={copilot.assistQuestion}
        onChange={(event) => copilot.setAssistQuestion(event.target.value)}
      />
      <button type="button" data-testid="generate" onClick={() => void copilot.generateAssistSuggestions()}>
        generate
      </button>
      <button type="button" data-testid="clear" onClick={() => copilot.clearAssistQuestion()}>
        clear
      </button>
      <button
        type="button"
        data-testid="copy"
        onClick={() => {
          const first = copilot.assistSuggestions[0];
          if (first) {
            void copilot.copyAssistCommand(first.command);
          }
        }}
      >
        copy
      </button>
      <button
        type="button"
        data-testid="insert"
        onClick={() => {
          const first = copilot.assistSuggestions[0];
          if (first) {
            copilot.insertAssistCommand(first.command);
          }
        }}
      >
        insert
      </button>
      <button
        type="button"
        data-testid="execute"
        onClick={() => {
          const first = copilot.assistSuggestions[0];
          if (first) {
            copilot.executeAssistCommand(first.command);
          }
        }}
      >
        execute
      </button>

      <textarea
        data-testid="runner-prompt"
        value={copilot.runnerPrompt}
        onChange={(event) => copilot.setRunnerPrompt(event.target.value)}
      />
      <button type="button" data-testid="runner-send" onClick={() => void copilot.sendRunnerMessage()}>
        runner-send
      </button>
      <button type="button" data-testid="runner-new-chat" onClick={() => copilot.startNewRunnerChat()}>
        runner-new-chat
      </button>
      <button type="button" data-testid="runner-open-chat" onClick={() => void copilot.openRunnerChat("chat-1")}>
        runner-open-chat
      </button>
      <button type="button" data-testid="runner-approve-next" onClick={() => void copilot.approveNextReviewCommand()}>
        runner-approve-next
      </button>
      <button type="button" data-testid="runner-approve-all" onClick={() => void copilot.approveAllReviewCommands()}>
        runner-approve-all
      </button>
      <button type="button" data-testid="runner-reject" onClick={() => void copilot.rejectReviewCommands()}>
        runner-reject
      </button>

      <div data-testid="assist-error">{copilot.assistError}</div>
      <div data-testid="assist-screen">{copilot.assistCapturedScreenText}</div>
      <div data-testid="assist-suggestions">{copilot.assistSuggestions.map((item) => item.command).join("|")}</div>
      <div data-testid="runner-error">{copilot.runnerError}</div>
      <div data-testid="runner-chat-id">{copilot.runnerChatId || ""}</div>
      <div data-testid="runner-history">{copilot.runnerHistory.map((item) => item.chatId).join("|")}</div>
      <div data-testid="runner-conversation">{copilot.runnerConversation.map((item) => `${item.role}:${item.text}`).join("|")}</div>
      <div data-testid="runner-plan">{copilot.runnerPlan.map((item) => item.title || "").join("|")}</div>
      <div
        data-testid="runner-review"
      >
        {(copilot.runnerPendingReview?.commands || []).map((item) => `${item.command}:${item.status}`).join("|")}
      </div>
    </div>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  apiClientMock.getSessionContext.mockReset();
  apiClientMock.getSessionScreenText.mockReset();
  apiClientMock.createAssistSuggestions.mockReset();
  apiClientMock.listCopilotAgents.mockReset();
  apiClientMock.listCopilotChats.mockReset();
  apiClientMock.getCopilotChat.mockReset();
  apiClientMock.streamCopilotQuery.mockReset();
  apiClientMock.submitCopilotTool.mockReset();
  apiClientMock.executeCopilotCommand.mockReset();

  apiClientMock.listCopilotAgents.mockResolvedValue([
    {
      key: "default-assist",
      label: "Default Assist",
      description: "Local assist suggestions",
      type: "builtin_assist",
      default: true
    }
  ]);
  apiClientMock.listCopilotChats.mockResolvedValue([]);
  apiClientMock.getCopilotChat.mockResolvedValue({
    chatId: "chat-1",
    chatName: "Chat 1",
    events: []
  });
  apiClientMock.streamCopilotQuery.mockResolvedValue(undefined);
  apiClientMock.submitCopilotTool.mockResolvedValue({
    accepted: true,
    status: "ok",
    runId: "run-1",
    toolId: "tool-1",
    detail: "accepted"
  });
  apiClientMock.executeCopilotCommand.mockResolvedValue({
    sessionId: "s1",
    command: "pwd",
    exitCode: 0,
    transcriptDelta: "/tmp/project\n",
    outputExcerpt: "/tmp/project\n",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:00:01Z"
  });

  clipboardWriteText.mockReset();
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: clipboardWriteText
    }
  });
});

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

function setTextareaValue(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useCopilotState", () => {
  it("reports an error when there is no active tab", async () => {
    render(
      <Harness
        activeTab={null}
        senderMapRef={{ current: new Map<string, (data: string) => boolean>() }}
        focusTerminal={vi.fn()}
        showNotice={vi.fn()}
      />
    );

    await act(async () => {
      (container?.querySelector("[data-testid='generate']") as HTMLButtonElement).click();
    });

    expect(container?.querySelector("[data-testid='assist-error']")?.textContent).toBe("No active tab");
  });

  it("requests assist suggestions even when question is empty", async () => {
    apiClientMock.createAssistSuggestions.mockResolvedValue({
      capturedScreenText: "modified: frontend/src/react/App.tsx",
      capturedChars: 34,
      suggestions: [
        { id: "one", command: "git status --short", reason: "Check repo state.", weight: 96 },
        { id: "two", command: "git diff --stat", reason: "See diff summary.", weight: 88 }
      ]
    });

    render(
      <Harness
        activeTab={makeTab()}
        senderMapRef={{ current: new Map<string, (data: string) => boolean>() }}
        focusTerminal={vi.fn()}
        showNotice={vi.fn()}
      />
    );
    await flushAsync();

    await act(async () => {
      (container?.querySelector("[data-testid='generate']") as HTMLButtonElement).click();
    });

    expect(apiClientMock.createAssistSuggestions).toHaveBeenCalledWith("s1", { question: undefined });
    expect(container?.querySelector("[data-testid='assist-screen']")?.textContent).toContain("frontend/src/react/App.tsx");
    expect(container?.querySelector("[data-testid='assist-suggestions']")?.textContent).toContain("git status --short");
  });

  it("supports write and execute command actions", async () => {
    apiClientMock.createAssistSuggestions.mockResolvedValue({
      capturedScreenText: "modified: frontend/src/react/App.tsx",
      capturedChars: 34,
      suggestions: [
        { id: "one", command: "git status --short", reason: "Check repo state.", weight: 96 }
      ]
    });

    const sender = vi.fn(() => true);
    const focusTerminal = vi.fn();
    const showNotice = vi.fn();
    const senderMapRef = { current: new Map<string, (data: string) => boolean>([["tab-1", sender]]) };

    render(
      <Harness
        activeTab={makeTab()}
        senderMapRef={senderMapRef}
        focusTerminal={focusTerminal}
        showNotice={showNotice}
      />
    );
    await flushAsync();

    const question = container?.querySelector("[data-testid='question']") as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(question, "What should I do next?");
    });
    await act(async () => {
      (container?.querySelector("[data-testid='generate']") as HTMLButtonElement).click();
    });
    await act(async () => {
      (container?.querySelector("[data-testid='insert']") as HTMLButtonElement).click();
    });
    await act(async () => {
      (container?.querySelector("[data-testid='execute']") as HTMLButtonElement).click();
    });

    expect(apiClientMock.createAssistSuggestions).toHaveBeenCalledWith("s1", { question: "What should I do next?" });
    expect(sender).toHaveBeenNthCalledWith(1, "git status --short");
    expect(sender).toHaveBeenNthCalledWith(2, "git status --short\r");
    expect(focusTerminal).toHaveBeenCalledWith("tab-1");
    expect(showNotice).toHaveBeenCalledTimes(2);
  });

  it("supports clearing the question and copying a command", async () => {
    apiClientMock.createAssistSuggestions.mockResolvedValue({
      capturedScreenText: "modified: frontend/src/react/App.tsx",
      capturedChars: 34,
      suggestions: [
        { id: "one", command: "git status --short", reason: "Check repo state.", weight: 96 }
      ]
    });
    clipboardWriteText.mockResolvedValue(undefined);

    const showNotice = vi.fn();
    render(
      <Harness
        activeTab={makeTab()}
        senderMapRef={{ current: new Map<string, (data: string) => boolean>() }}
        focusTerminal={vi.fn()}
        showNotice={showNotice}
      />
    );
    await flushAsync();

    const question = container?.querySelector("[data-testid='question']") as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(question, "Need a command");
    });
    await act(async () => {
      (container?.querySelector("[data-testid='clear']") as HTMLButtonElement).click();
    });

    expect(question.value).toBe("");

    await act(async () => {
      (container?.querySelector("[data-testid='generate']") as HTMLButtonElement).click();
    });
    await act(async () => {
      (container?.querySelector("[data-testid='copy']") as HTMLButtonElement).click();
    });

    expect(clipboardWriteText).toHaveBeenCalledWith("git status --short");
    expect(showNotice).toHaveBeenCalledWith("Command copied", "success", 1800);
  });

  it("switches agents, loads runner history, and resets chat on new chat", async () => {
    apiClientMock.listCopilotAgents.mockResolvedValue([
      {
        key: "default-assist",
        label: "Default Assist",
        description: "Local assist suggestions",
        type: "builtin_assist",
        default: true
      },
      {
        key: "terminal-helper",
        label: "Terminal Helper",
        description: "Runner terminal assistant",
        type: "runner_agent",
        runnerAgentKey: "terminalAssistant",
        default: false
      }
    ]);
    apiClientMock.listCopilotChats.mockResolvedValue([
      {
        chatId: "chat-1",
        chatName: "Chat 1",
        agentKey: "terminalAssistant",
        createdAt: 1,
        updatedAt: 2,
        lastRunId: "run-1",
        lastRunContent: "Inspect repository",
        readStatus: 1,
        readAt: null
      }
    ]);
    apiClientMock.getCopilotChat.mockResolvedValue({
      chatId: "chat-1",
      chatName: "Chat 1",
      events: [
        { type: "request.query", requestId: "req-1", message: "Inspect repository" },
        { type: "content.snapshot", contentId: "msg-1", text: "Plan ready." }
      ]
    });

    render(
      <Harness
        activeTab={makeTab()}
        senderMapRef={{ current: new Map<string, (data: string) => boolean>() }}
        focusTerminal={vi.fn()}
        showNotice={vi.fn()}
      />
    );
    await flushAsync();

    const select = container?.querySelector("[data-testid='agent-select']") as HTMLSelectElement;
    await act(async () => {
      setSelectValue(select, "terminal-helper");
    });
    await flushAsync();

    expect(apiClientMock.listCopilotChats).toHaveBeenCalledWith("s1", "terminal-helper");
    expect(container?.querySelector("[data-testid='runner-history']")?.textContent).toContain("chat-1");

    await act(async () => {
      (container?.querySelector("[data-testid='runner-open-chat']") as HTMLButtonElement).click();
    });
    await flushAsync();

    expect(container?.querySelector("[data-testid='runner-chat-id']")?.textContent).toBe("chat-1");
    expect(container?.querySelector("[data-testid='runner-conversation']")?.textContent).toContain("assistant:Plan ready.");

    await act(async () => {
      (container?.querySelector("[data-testid='runner-new-chat']") as HTMLButtonElement).click();
    });

    expect(container?.querySelector("[data-testid='runner-chat-id']")?.textContent).toBe("");
    expect(container?.querySelector("[data-testid='runner-conversation']")?.textContent).toBe("");
  });

  it("rejects runner execution on non-shell tabs", async () => {
    apiClientMock.listCopilotAgents.mockResolvedValue([
      {
        key: "default-assist",
        label: "Default Assist",
        description: "Local assist suggestions",
        type: "builtin_assist",
        default: true
      },
      {
        key: "terminal-helper",
        label: "Terminal Helper",
        description: "Runner terminal assistant",
        type: "runner_agent",
        runnerAgentKey: "terminalAssistant",
        default: false
      }
    ]);

    render(
      <Harness
        activeTab={makeTab({ toolId: "codex" })}
        senderMapRef={{ current: new Map<string, (data: string) => boolean>() }}
        focusTerminal={vi.fn()}
        showNotice={vi.fn()}
      />
    );
    await flushAsync();

    const select = container?.querySelector("[data-testid='agent-select']") as HTMLSelectElement;
    const prompt = container?.querySelector("[data-testid='runner-prompt']") as HTMLTextAreaElement;
    await act(async () => {
      setSelectValue(select, "terminal-helper");
    });
    await flushAsync();
    await act(async () => {
      setTextareaValue(prompt, "List plan");
    });
    await act(async () => {
      (container?.querySelector("[data-testid='runner-send']") as HTMLButtonElement).click();
    });

    expect(apiClientMock.streamCopilotQuery).not.toHaveBeenCalled();
    expect(container?.querySelector("[data-testid='runner-error']")?.textContent)
      .toBe("Runner agents require a shell or SSH terminal tab.");
  });

  it("executes approve-all review flow and submits once after all commands complete", async () => {
    apiClientMock.listCopilotAgents.mockResolvedValue([
      {
        key: "default-assist",
        label: "Default Assist",
        description: "Local assist suggestions",
        type: "builtin_assist",
        default: true
      },
      {
        key: "terminal-helper",
        label: "Terminal Helper",
        description: "Runner terminal assistant",
        type: "runner_agent",
        runnerAgentKey: "terminalAssistant",
        default: false
      }
    ]);
    apiClientMock.streamCopilotQuery.mockImplementation(async (_sessionId, _payload, options) => {
      options.onEvent({ type: "chat.start", chatId: "chat-2", runId: "run-1" });
      options.onEvent({
        type: "plan.update",
        plan: [
          { taskId: "t1", title: "Inspect repo", status: "in_progress" },
          { taskId: "t2", title: "Run checks", status: "pending" }
        ]
      });
      options.onEvent({
        type: "tool.start",
        chatId: "chat-2",
        runId: "run-1",
        toolId: "tool-1",
        toolKey: "terminal_command_review",
        toolParams: {
          title: "Review commands",
          summary: "Need approval before execution.",
          allowBatchApprove: true,
          commands: [
            { id: "cmd-1", title: "Inspect repo", command: "pwd", reason: "Check workdir", highRisk: false },
            { id: "cmd-2", title: "List files", command: "ls", reason: "Inspect files", highRisk: false }
          ]
        }
      });
    });
    apiClientMock.executeCopilotCommand
      .mockResolvedValueOnce({
        sessionId: "s1",
        command: "pwd",
        exitCode: 0,
        transcriptDelta: "/tmp/project\n",
        outputExcerpt: "/tmp/project\n",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:01Z"
      })
      .mockResolvedValueOnce({
        sessionId: "s1",
        command: "ls",
        exitCode: 0,
        transcriptDelta: "README.md\n",
        outputExcerpt: "README.md\n",
        startedAt: "2026-01-01T00:00:02Z",
        completedAt: "2026-01-01T00:00:03Z"
      });

    const showNotice = vi.fn();
    render(
      <Harness
        activeTab={makeTab()}
        senderMapRef={{ current: new Map<string, (data: string) => boolean>() }}
        focusTerminal={vi.fn()}
        showNotice={showNotice}
      />
    );
    await flushAsync();

    const select = container?.querySelector("[data-testid='agent-select']") as HTMLSelectElement;
    const prompt = container?.querySelector("[data-testid='runner-prompt']") as HTMLTextAreaElement;
    await act(async () => {
      setSelectValue(select, "terminal-helper");
    });
    await flushAsync();
    await act(async () => {
      setTextareaValue(prompt, "Inspect the repository");
    });
    await act(async () => {
      (container?.querySelector("[data-testid='runner-send']") as HTMLButtonElement).click();
    });

    expect(container?.querySelector("[data-testid='runner-plan']")?.textContent).toContain("Inspect repo");
    expect(container?.querySelector("[data-testid='runner-review']")?.textContent).toContain("pwd:pending");

    await act(async () => {
      (container?.querySelector("[data-testid='runner-approve-all']") as HTMLButtonElement).click();
    });
    await flushAsync();

    expect(apiClientMock.executeCopilotCommand).toHaveBeenCalledTimes(2);
    expect(apiClientMock.submitCopilotTool).toHaveBeenCalledTimes(1);
    expect(apiClientMock.submitCopilotTool).toHaveBeenCalledWith("s1", {
      runId: "run-1",
      toolId: "tool-1",
      params: {
        approved: true,
        status: "completed",
        commandCount: 2,
        commands: [
          expect.objectContaining({ id: "cmd-1", status: "completed", exitCode: 0 }),
          expect.objectContaining({ id: "cmd-2", status: "completed", exitCode: 0 })
        ]
      }
    });
    expect(showNotice).toHaveBeenCalledWith("Submitted command review", "success", 1800);
    expect(container?.querySelector("[data-testid='runner-review']")?.textContent).toBe("");
  });
});
