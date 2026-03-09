import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCopilotState } from "../react/shared/hooks/useCopilotState";
import type { TerminalTab } from "../react/features/tabs/useTabsStore";

const apiClientMock = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  getSessionScreenText: vi.fn(),
  createAssistSuggestions: vi.fn()
}));

const clipboardWriteText = vi.fn();

vi.mock("../react/shared/api/client", () => ({
  apiClient: apiClientMock
}));

function makeTab(): TerminalTab {
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
    exitCode: "-"
  };
}

interface HarnessProps {
  activeTab: TerminalTab | null;
  senderMapRef: React.RefObject<Map<string, (data: string) => boolean>>;
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
      <div data-testid="assist-error">{copilot.assistError}</div>
      <div data-testid="assist-screen">{copilot.assistCapturedScreenText}</div>
      <div data-testid="assist-suggestions">{copilot.assistSuggestions.map((item) => item.command).join("|")}</div>
    </div>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  apiClientMock.getSessionContext.mockReset();
  apiClientMock.getSessionScreenText.mockReset();
  apiClientMock.createAssistSuggestions.mockReset();
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

describe("useCopilotState assist mode", () => {
  it("reports an error when there is no active tab", async () => {
    const senderMapRef = { current: new Map<string, (data: string) => boolean>() };

    render(
      <Harness
        activeTab={null}
        senderMapRef={senderMapRef}
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
        { id: "one", command: "git status --short", reason: "Check repo state." },
        { id: "two", command: "git diff --stat", reason: "See diff summary." },
        { id: "three", command: "pwd", reason: "Check current directory." },
        { id: "four", command: "ls -la", reason: "Inspect files." },
        { id: "five", command: "npm test", reason: "Run tests." }
      ]
    });

    const senderMapRef = { current: new Map<string, (data: string) => boolean>() };
    render(
      <Harness
        activeTab={makeTab()}
        senderMapRef={senderMapRef}
        focusTerminal={vi.fn()}
        showNotice={vi.fn()}
      />
    );

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
        { id: "one", command: "git status --short", reason: "Check repo state." },
        { id: "two", command: "git diff --stat", reason: "See diff summary." },
        { id: "three", command: "pwd", reason: "Check current directory." },
        { id: "four", command: "ls -la", reason: "Inspect files." },
        { id: "five", command: "npm test", reason: "Run tests." }
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
        { id: "one", command: "git status --short", reason: "Check repo state." }
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
});
