import { useCallback, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { generateId } from "../utils/id";
import type { TerminalTab } from "../../features/tabs/useTabsStore";
import type { TerminalPaneHandle } from "../../features/terminal/TerminalPane";

interface UseTabManagerOptions {
  tabs: TerminalTab[];
  activeTab: TerminalTab | null;
  removeTab: (localId: string) => void;
  replaceTabSession: (
    localId: string,
    replacement: Pick<TerminalTab, "sessionId" | "wsUrl" | "clientId" | "createRequest">
  ) => void;
  setTabStatus: (localId: string, status: "connecting" | "connected" | "disconnected" | "exited" | "error") => void;
  setTabLost: (localId: string, lost: boolean) => void;
  setTabExitCode: (localId: string, exitCode: string) => void;
  closeSession: (sessionId: string) => Promise<void>;
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
}

export function useTabManager({
  tabs,
  activeTab,
  removeTab,
  replaceTabSession,
  setTabStatus,
  setTabLost,
  setTabExitCode,
  closeSession,
  showNotice
}: UseTabManagerOptions) {
  const senderMapRef = useRef(new Map<string, (data: string) => boolean>());
  const terminalHandleMapRef = useRef(new Map<string, TerminalPaneHandle>());
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);

  const handleTabStatusChange = useCallback((localId: string, status: "connecting" | "connected" | "disconnected" | "exited" | "error") => {
    setTabStatus(localId, status);
  }, [setTabStatus]);

  const handleTabLostChange = useCallback((localId: string, lost: boolean) => {
    setTabLost(localId, lost);
  }, [setTabLost]);

  const handleTabExitCodeChange = useCallback((localId: string, exitCode: string) => {
    setTabExitCode(localId, exitCode);
  }, [setTabExitCode]);

  const handleRegisterInputSender = useCallback((localId: string, sender: ((data: string) => boolean) | null) => {
    if (!sender) {
      senderMapRef.current.delete(localId);
      return;
    }
    senderMapRef.current.set(localId, sender);
  }, []);

  const handleTerminalReady = useCallback((localId: string, handle: TerminalPaneHandle | null) => {
    if (!handle) {
      terminalHandleMapRef.current.delete(localId);
      return;
    }
    terminalHandleMapRef.current.set(localId, handle);
  }, []);

  async function closeTab(localId: string): Promise<void> {
    const tab = tabs.find((item) => item.localId === localId);
    if (!tab) {
      return;
    }
    try {
      await closeSession(tab.sessionId);
    } catch {
      // backend may already close this session
    }
    senderMapRef.current.delete(localId);
    terminalHandleMapRef.current.delete(localId);
    removeTab(localId);
  }

  function isTabSessionActive(tab: TerminalTab): boolean {
    return (tab.status === "connecting" || tab.status === "connected") && !tab.lost;
  }

  function requestCloseTab(localId: string): void {
    const tab = tabs.find((item) => item.localId === localId);
    if (!tab) {
      return;
    }
    if (isTabSessionActive(tab)) {
      setPendingCloseTabId(localId);
    } else {
      void closeTab(localId);
    }
  }

  function confirmCloseTab(): void {
    if (pendingCloseTabId) {
      void closeTab(pendingCloseTabId);
    }
    setPendingCloseTabId(null);
  }

  function cancelCloseTab(): void {
    setPendingCloseTabId(null);
  }

  async function rebuildTab(localId: string): Promise<void> {
    const tab = tabs.find((item) => item.localId === localId);
    if (!tab || !tab.createRequest) {
      showNotice("Rebuild unavailable for restored tab", "warn", 2800);
      return;
    }

    setTabStatus(localId, "connecting");
    setTabLost(localId, false);
    setTabExitCode(localId, "-");

    try {
      const response = await apiClient.createSession(tab.createRequest);
      try {
        await apiClient.closeSession(tab.sessionId);
      } catch {
        // ignore old session close failure
      }
      replaceTabSession(localId, {
        sessionId: response.sessionId,
        wsUrl: response.wsUrl,
        clientId: generateId(),
        createRequest: tab.createRequest
      });
      showNotice(`Rebuilt ${tab.title}`, "success", 2200);
    } catch (error) {
      setTabStatus(localId, "error");
      showNotice(error instanceof Error ? error.message : "Failed to rebuild session", "error", 3200);
    }
  }

  function sendMobileShortcut(sequence: string): void {
    if (!activeTab) {
      showNotice("No active tab", "warn");
      return;
    }
    const sender = senderMapRef.current.get(activeTab.localId);
    if (!sender) {
      showNotice("Active terminal is not ready", "warn");
      return;
    }
    const ok = sender(sequence);
    if (!ok) {
      showNotice("Terminal is not connected", "warn");
      return;
    }
    terminalHandleMapRef.current.get(activeTab.localId)?.focus();
  }

  async function pasteToActiveTerminal(): Promise<void> {
    if (!activeTab) {
      showNotice("No active tab", "warn");
      return;
    }
    try {
      if (!navigator.clipboard?.readText) {
        throw new Error("Clipboard API unavailable");
      }
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }
      const sender = senderMapRef.current.get(activeTab.localId);
      if (!sender || !sender(text)) {
        showNotice("Terminal is not connected", "warn");
        return;
      }
      terminalHandleMapRef.current.get(activeTab.localId)?.focus();
    } catch {
      showNotice("Paste failed in this browser context", "warn");
    }
  }

  function focusTerminal(localId: string): void {
    terminalHandleMapRef.current.get(localId)?.focus();
  }

  return {
    senderMapRef,
    terminalHandleMapRef,
    pendingCloseTabId,
    handleTabStatusChange,
    handleTabLostChange,
    handleTabExitCodeChange,
    handleRegisterInputSender,
    handleTerminalReady,
    closeTab,
    requestCloseTab,
    confirmCloseTab,
    cancelCloseTab,
    rebuildTab,
    sendMobileShortcut,
    pasteToActiveTerminal,
    focusTerminal
  };
}
