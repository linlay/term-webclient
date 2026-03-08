import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const hoisted = vi.hoisted(() => {
  return {
    terminalFocusSpy: vi.fn(),
    fitSpy: vi.fn(),
    terminalConstructSpy: vi.fn(),
    terminalDisposeSpy: vi.fn()
  };
});

vi.mock("xterm", () => {
  class MockTerminal {
    constructor() {
      hoisted.terminalConstructSpy();
    }

    cols = 120;
    rows = 40;
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0
      }
    };

    onDataCallbacks: Array<(value: string) => void> = [];

    loadAddon() {
      // no-op
    }

    open() {
      // no-op
    }

    dispose() {
      hoisted.terminalDisposeSpy();
    }

    onData(callback: (value: string) => void) {
      this.onDataCallbacks.push(callback);
      return {
        dispose: () => {
          this.onDataCallbacks = this.onDataCallbacks.filter((item) => item !== callback);
        }
      };
    }

    focus() {
      hoisted.terminalFocusSpy();
    }

    scrollToBottom() {
      this.buffer.active.viewportY = this.buffer.active.baseY;
    }

    write() {
      // no-op
    }

    writeln() {
      // no-op
    }
  }

  return {
    Terminal: MockTerminal
  };
});

vi.mock("xterm-addon-fit", () => {
  return {
    FitAddon: class {
      fit() {
        hoisted.fitSpy();
      }
    }
  };
});

import { TerminalPane, type TerminalPaneHandle } from "../react/features/terminal/TerminalPane";
import type { TerminalTab } from "../react/features/tabs/useTabsStore";

class MockWebSocket {
  static OPEN = 1;

  readyState = MockWebSocket.OPEN;

  listeners: Record<string, Array<() => void>> = {};

  constructor(public url: string) {
    void this.url;
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];

  addEventListener(event: string, listener: () => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  send(): void {
    // no-op
  }

  close(): void {
    // no-op
  }

  trigger(event: "open" | "close" | "error"): void {
    (this.listeners[event] || []).forEach((listener) => listener());
  }
}

class MockResizeObserver {
  observe(): void {
    // no-op
  }

  disconnect(): void {
    // no-op
  }
}

function makeTab(): TerminalTab {
  return {
    localId: "tab-1",
    title: "terminal",
    sessionId: "s1",
    wsUrl: "/ws/s1",
    clientId: "c1",
    status: "connecting",
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

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  hoisted.terminalFocusSpy.mockClear();
  hoisted.fitSpy.mockClear();
  hoisted.terminalConstructSpy.mockClear();
  hoisted.terminalDisposeSpy.mockClear();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
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
  vi.unstubAllGlobals();
});

function render(node: JSX.Element): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

describe("TerminalPane", () => {
  it("registers terminal handle and clears it on unmount", () => {
    const handles: Array<TerminalPaneHandle | null> = [];

    render(
      <TerminalPane
        tab={makeTab()}
        isActive={true}
        onStatusChange={vi.fn()}
        onTerminalReady={(_localId, handle) => {
          handles.push(handle);
        }}
      />
    );

    expect(handles[0]).toBeTruthy();
    expect(typeof handles[0]?.scrollToBottom).toBe("function");
    expect(typeof handles[0]?.isNearBottom).toBe("function");

    act(() => {
      root?.unmount();
    });

    expect(handles[handles.length - 1]).toBeNull();
  });

  it("does not focus terminal when inactive on websocket open", () => {
    render(
      <TerminalPane
        tab={makeTab()}
        isActive={false}
        onStatusChange={vi.fn()}
      />
    );

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeTruthy();

    act(() => {
      socket.trigger("open");
    });

    expect(hoisted.terminalFocusSpy).not.toHaveBeenCalled();
  });

  it("does not recreate terminal instance when active state toggles", () => {
    const onStatusChange = vi.fn();

    render(
      <TerminalPane
        tab={makeTab()}
        isActive={false}
        onStatusChange={onStatusChange}
      />
    );

    expect(hoisted.terminalConstructSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.terminalDisposeSpy).toHaveBeenCalledTimes(0);

    act(() => {
      root?.render(
        <TerminalPane
          tab={makeTab()}
          isActive={true}
          onStatusChange={onStatusChange}
        />
      );
    });

    expect(hoisted.terminalConstructSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.terminalDisposeSpy).toHaveBeenCalledTimes(0);
  });
});
