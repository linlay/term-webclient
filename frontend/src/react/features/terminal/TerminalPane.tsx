import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import type { WsServerMessage } from "../../shared/api/types";
import { isAppMode, toWsUrl } from "../../shared/config/env";
import { getAppAccessToken, refreshAppAccessToken } from "../../shared/auth/appBridge";
import type { TerminalTab } from "../tabs/useTabsStore";

interface TerminalPaneProps {
  tab: TerminalTab;
  onStatusChange: (status: TerminalTab["status"]) => void;
}

interface WsInputMessage {
  type: "input";
  data: string;
}

interface WsResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

function safeJsonParse(value: string): WsServerMessage | null {
  try {
    const parsed = JSON.parse(value) as WsServerMessage;
    return parsed;
  } catch {
    return null;
  }
}

export function TerminalPane({ tab, onStatusChange }: TerminalPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!hostRef.current || termRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "SFMono-Regular, Menlo, Consolas, monospace",
      scrollback: 4000
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();

    termRef.current = terminal;
    fitRef.current = fitAddon;

    const onWindowResize = () => {
      fitAddon.fit();
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      const resizePayload: WsResizeMessage = {
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows
      };
      ws.send(JSON.stringify(resizePayload));
    };

    const resizeObserver = new ResizeObserver(onWindowResize);
    resizeObserver.observe(hostRef.current);

    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      resizeObserver.disconnect();
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

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
    let lastSeenSeq = 0;

    function clearReconnectTimer() {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function sendResize(socket: WebSocket) {
      const resizePayload: WsResizeMessage = {
        type: "resize",
        cols: terminalInstance.cols,
        rows: terminalInstance.rows
      };
      socket.send(JSON.stringify(resizePayload));
    }

    function scheduleReconnect() {
      if (disposed || exited) {
        return;
      }
      const delay = Math.min(30000, Math.max(1000, 1000 * (2 ** reconnectAttempts)));
      reconnectAttempts += 1;
      onStatusChange("connecting");
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delay);
    }

    async function connect() {
      if (disposed || exited) {
        return;
      }

      const query = new URLSearchParams({ clientId: tab.clientId });
      if (lastSeenSeq > 0) {
        query.set("lastSeenSeq", String(lastSeenSeq));
      }
      if (isAppMode()) {
        let accessToken = getAppAccessToken();
        if (!accessToken) {
          accessToken = await refreshAppAccessToken("missing");
        }
        if (!accessToken) {
          onStatusChange("error");
          scheduleReconnect();
          return;
        }
        query.set("accessToken", accessToken);
      }

      const socket = new WebSocket(toWsUrl(`${tab.wsUrl}?${query.toString()}`));
      wsRef.current = socket;
      onStatusChange("connecting");

      socket.addEventListener("open", () => {
        reconnectAttempts = 0;
        onStatusChange("connected");
        fitAddonInstance.fit();
        sendResize(socket);
        terminalInstance.focus();
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
            if (Number.isFinite(message.seq) && message.seq > lastSeenSeq) {
              lastSeenSeq = message.seq;
            }
            break;
          case "error":
            terminalInstance.writeln(`\r\n[error] ${message.message}`);
            onStatusChange("error");
            break;
          case "exit":
            terminalInstance.writeln(`\r\n[process exited: ${message.exitCode}]`);
            exited = true;
            onStatusChange("exited");
            clearReconnectTimer();
            break;
          case "truncated":
            terminalInstance.writeln("\r\n[buffer truncated, reload snapshot in legacy mode if needed]");
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
          onStatusChange("disconnected");
          scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        onStatusChange("error");
      });
    }

    void connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      inputDisposable.dispose();
      const socket = wsRef.current;
      if (socket) {
        socket.close();
      }
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
    };
  }, [onStatusChange, tab.clientId, tab.wsUrl]);

  return <div className="react-terminal-host" ref={hostRef} />;
}
