import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCopilotState } from "../react/shared/hooks/useCopilotState";
import type { TerminalTab } from "../react/features/tabs/useTabsStore";

const apiClientMock = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  getSessionScreenText: vi.fn(),
  getAgentRun: vi.fn(),
  createAgentRun: vi.fn(),
  approveAgentRun: vi.fn(),
  abortAgentRun: vi.fn()
}));

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
    showNotice,
    setTabAgentRunId: vi.fn()
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
      <div data-testid="assist-error">{copilot.assistError}</div>
      <div data-testid="assist-suggestions">{copilot.assistSuggestions.map((item) => item.command).join("|")}</div>
    </div>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  apiClientMock.getSessionContext.mockReset();
  apiClientMock.getSessionScreenText.mockReset();
  apiClientMock.getAgentRun.mockReset();
  apiClientMock.createAgentRun.mockReset();
  apiClientMock.approveAgentRun.mockReset();
  apiClientMock.abortAgentRun.mockReset();
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

    const question = container?.querySelector("[data-testid='question']") as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(question, "What should I run?");
    });
    await act(async () => {
      (container?.querySelector("[data-testid='generate']") as HTMLButtonElement).click();
    });

    expect(container?.querySelector("[data-testid='assist-error']")?.textContent).toBe("No active tab");
  });

  it("generates mock suggestions from refreshed summary screen text", async () => {
    apiClientMock.getSessionContext.mockResolvedValue({
      sessionId: "s1",
      meta: {},
      commands: [],
      events: [],
      summary: "git repo"
    });
    apiClientMock.getSessionScreenText.mockResolvedValue({
      sessionId: "s1",
      lastSeq: 8,
      cols: 120,
      rows: 40,
      text: "modified: frontend/src/react/App.tsx\nOn branch main"
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

    const question = container?.querySelector("[data-testid='question']") as HTMLTextAreaElement;
    await act(async () => {
      setTextareaValue(question, "How do I inspect git changes?");
    });
    await act(async () => {
      (container?.querySelector("[data-testid='generate']") as HTMLButtonElement).click();
    });

    expect(container?.querySelector("[data-testid='assist-error']")?.textContent).toBe("");
    expect(container?.querySelector("[data-testid='assist-suggestions']")?.textContent).toContain("git status --short");
    expect(apiClientMock.getSessionScreenText).toHaveBeenCalledWith("s1");
  });

  it("inserts suggested commands into the terminal without appending a newline", async () => {
    apiClientMock.getSessionContext.mockResolvedValue({
      sessionId: "s1",
      meta: {},
      commands: [],
      events: [],
      summary: "git repo"
    });
    apiClientMock.getSessionScreenText.mockResolvedValue({
      sessionId: "s1",
      lastSeq: 8,
      cols: 120,
      rows: 40,
      text: "modified: frontend/src/react/App.tsx\nOn branch main"
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
      setTextareaValue(question, "How do I inspect git changes?");
    });
    await act(async () => {
      (container?.querySelector("[data-testid='generate']") as HTMLButtonElement).click();
    });
    await act(async () => {
      (container?.querySelector("[data-testid='insert']") as HTMLButtonElement).click();
    });

    expect(sender).toHaveBeenCalledWith("git status --short");
    expect(sender).not.toHaveBeenCalledWith("git status --short\r");
    expect(focusTerminal).toHaveBeenCalledWith("tab-1");
    expect(showNotice).toHaveBeenCalled();
  });
});
