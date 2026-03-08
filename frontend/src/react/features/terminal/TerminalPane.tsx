import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import type { WsServerMessage } from "../../shared/api/types";
import { apiClient } from "../../shared/api/client";
import { isAppMode, toWsUrl } from "../../shared/config/env";
import { getAppAccessToken, refreshAppAccessToken } from "../../shared/auth/appBridge";
import type { TerminalTab } from "../tabs/useTabsStore";
import { replaySnapshotChunks } from "./snapshot";

interface WsInputMessage {
  type: "input";
  data: string;
}

interface WsResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

const DESKTOP_TERMINAL_FONT_SIZE = 14;
const MOBILE_TERMINAL_FONT_SIZE = 12;

function getTerminalFontSize(): number {
  return window.innerWidth <= 900 ? MOBILE_TERMINAL_FONT_SIZE : DESKTOP_TERMINAL_FONT_SIZE;
}

function syncTerminalFontSize(terminal: Terminal): void {
  const nextFontSize = getTerminalFontSize();
  if (terminal.options.fontSize !== nextFontSize) {
    terminal.options.fontSize = nextFontSize;
  }
}

export interface TerminalPaneHandle {
  scrollToBottom: () => void;
  isNearBottom: () => boolean;
  focus: () => void;
}

interface TerminalPaneProps {
  tab: TerminalTab;
  isActive: boolean;
  onStatusChange: (localId: string, status: TerminalTab["status"]) => void;
  onRegisterInputSender?: (localId: string, sender: ((data: string) => boolean) | null) => void;
  onTerminalReady?: (localId: string, handle: TerminalPaneHandle | null) => void;
  onExitCodeChange?: (localId: string, exitCode: string) => void;
  onLostChange?: (localId: string, lost: boolean) => void;
}

function safeJsonParse(value: string): WsServerMessage | null {
  try {
    const parsed = JSON.parse(value) as WsServerMessage;
    return parsed;
  } catch {
    return null;
  }
}

function sendResize(socket: WebSocket, terminal: Terminal): void {
  const resizePayload: WsResizeMessage = {
    type: "resize",
    cols: terminal.cols,
    rows: terminal.rows
  };
  socket.send(JSON.stringify(resizePayload));
}

function isTerminalNearBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  const viewportY = Number(buffer.viewportY);
  const baseY = Number(buffer.baseY);
  if (!Number.isFinite(viewportY) || !Number.isFinite(baseY)) {
    return true;
  }
  return viewportY >= baseY;
}

export function TerminalPane({
  tab,
  isActive,
  onStatusChange,
  onRegisterInputSender,
  onTerminalReady,
  onExitCodeChange,
  onLostChange
}: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeenSeqRef = useRef(0);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (!hostRef.current || termRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: getTerminalFontSize(),
      fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
      scrollback: 5000,
      convertEol: true,
      theme: {
        background: "#09101a"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);

    if (isActive) {
      try {
        fitAddon.fit();
      } catch {
        // ignore fit failure in zero-sized layouts
      }
    }

    termRef.current = terminal;
    fitRef.current = fitAddon;

    const handle: TerminalPaneHandle = {
      scrollToBottom: () => {
        terminal.scrollToBottom();
      },
      isNearBottom: () => isTerminalNearBottom(terminal),
      focus: () => {
        terminal.focus();
      }
    };
    onTerminalReady?.(tab.localId, handle);

    const onWindowResize = () => {
      if (!isActiveRef.current) {
        return;
      }
      syncTerminalFontSize(terminal);
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      sendResize(ws, terminal);
    };

    const resizeObserver = new ResizeObserver(onWindowResize);
    resizeObserver.observe(hostRef.current);

    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      resizeObserver.disconnect();
      onTerminalReady?.(tab.localId, null);
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [onTerminalReady, tab.localId]);

  useEffect(() => {
    if (!isActive || !termRef.current || !fitRef.current) {
      return;
    }
    const terminal = termRef.current;
    const fitAddon = fitRef.current;

    const rafId = window.requestAnimationFrame(() => {
      syncTerminalFontSize(terminal);
      try {
        fitAddon.fit();
      } catch {
        // ignore fit failures while hidden or detached
      }
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        sendResize(socket, terminal);
      }
      terminal.focus();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isActive, tab.localId]);

  useEffect(() => {
    if (!termRef.current || !fitRef.current) {
      return;
    }
    const terminalInstance = termRef.current;
    const fitAddonInstance = fitRef.current;

    const inputDisposable = terminalInstance.onData((value) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const payload: WsInputMessage = {
        type: "input",
        data: value
      };
      socket.send(JSON.stringify(payload));
    });

    let disposed = false;
    let exited = false;
    let reconnectAttempts = 0;
    let reconnectTimer: number | null = null;
    let snapshotReloadInFlight = false;

    function clearReconnectTimer() {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect() {
      if (disposed || exited) {
        return;
      }
      const delay = Math.min(30000, Math.max(1000, 1000 * (2 ** reconnectAttempts)));
      reconnectAttempts += 1;
      onStatusChange(tab.localId, "connecting");
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
    }

    async function reloadSnapshot(afterSeq: number) {
      if (snapshotReloadInFlight || disposed || exited) {
        return;
      }
      snapshotReloadInFlight = true;
      try {
        const snapshot = await apiClient.getSessionSnapshot(tab.sessionId, afterSeq);
        lastSeenSeqRef.current = replaySnapshotChunks(snapshot.chunks, lastSeenSeqRef.current, (data) => {
          terminalInstance.write(data);
        });
        if (snapshot.truncated) {
          terminalInstance.writeln("\r\n[buffer truncated, showing latest snapshot window]");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        terminalInstance.writeln(`\r\n[snapshot reload failed: ${message}]`);
      } finally {
        snapshotReloadInFlight = false;
      }
    }

    async function connect() {
      if (disposed || exited) {
        return;
      }

      const query = new URLSearchParams({ clientId: tab.clientId });
      if (lastSeenSeqRef.current > 0) {
        query.set("lastSeenSeq", String(lastSeenSeqRef.current));
      }
      if (isAppMode()) {
        let accessToken = getAppAccessToken();
        if (!accessToken) {
          accessToken = await refreshAppAccessToken("missing");
        }
        if (!accessToken) {
          onStatusChange(tab.localId, "error");
          scheduleReconnect();
          return;
        }
        query.set("accessToken", accessToken);
      }

      const socket = new WebSocket(toWsUrl(`${tab.wsUrl}?${query.toString()}`));
      wsRef.current = socket;
      onStatusChange(tab.localId, "connecting");

      socket.addEventListener("open", () => {
        reconnectAttempts = 0;
        onStatusChange(tab.localId, "connected");
        onLostChange?.(tab.localId, false);
        if (isActiveRef.current) {
          try {
            fitAddonInstance.fit();
          } catch {
            // ignore fit failure
          }
          sendResize(socket, terminalInstance);
          terminalInstance.focus();
        }
      });

      socket.addEventListener("message", (event) => {
        const message = safeJsonParse(String(event.data));
        if (!message) {
          terminalInstance.write(String(event.data));
          return;
        }

        switch (message.type) {
          case "output":
            terminalInstance.write(message.data);
            if (Number.isFinite(message.seq) && message.seq > lastSeenSeqRef.current) {
              lastSeenSeqRef.current = message.seq;
            }
            break;
          case "error":
            terminalInstance.writeln(`\r\n[error] ${message.message}`);
            if (/session not found/i.test(message.message)) {
              onLostChange?.(tab.localId, true);
            }
            onStatusChange(tab.localId, "error");
            break;
          case "exit":
            terminalInstance.writeln(`\r\n[process exited: ${message.exitCode}]`);
            exited = true;
            onExitCodeChange?.(tab.localId, String(message.exitCode));
            onStatusChange(tab.localId, "exited");
            clearReconnectTimer();
            break;
          case "truncated":
            terminalInstance.writeln("\r\n[buffer truncated, reloading snapshot...]");
            void reloadSnapshot(lastSeenSeqRef.current || message.requestedAfterSeq || 0);
            break;
          case "pong":
          default:
            break;
        }
      });

      socket.addEventListener("close", () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (!exited) {
          onStatusChange(tab.localId, "disconnected");
          scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        onStatusChange(tab.localId, "error");
      });
    }

    void connect();

    if (onRegisterInputSender) {
      onRegisterInputSender(tab.localId, (data: string) => {
        const socket = wsRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return false;
        }
        const payload: WsInputMessage = {
          type: "input",
          data
        };
        socket.send(JSON.stringify(payload));
        return true;
      });
    }

    return () => {
      disposed = true;
      clearReconnectTimer();
      if (onRegisterInputSender) {
        onRegisterInputSender(tab.localId, null);
      }
      inputDisposable.dispose();
      const socket = wsRef.current;
      if (socket) {
        socket.close();
      }
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
    };
  }, [onExitCodeChange, onLostChange, onRegisterInputSender, onStatusChange, tab.clientId, tab.localId, tab.sessionId, tab.wsUrl]);

  return <div className="react-terminal-host" ref={hostRef} />;
}
