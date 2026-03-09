import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { COPILOT_REFRESH_MS } from "../config/env";
import type { AssistSuggestionItem } from "../api/types";
import type { TerminalTab } from "../../features/tabs/useTabsStore";

export interface UseCopilotStateOptions {
  activeTab: TerminalTab | null;
  senderMapRef: React.RefObject<Map<string, (data: string) => boolean>>;
  focusTerminal: (localId: string) => void;
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
}

export interface UseCopilotStateReturn {
  sideTab: "summary" | "assist";
  setSideTab: (tab: "summary" | "assist") => void;
  isCopilotOpen: boolean;
  setIsCopilotOpen: React.Dispatch<React.SetStateAction<boolean>>;
  summaryContext: string;
  summaryScreenText: string;
  summaryError: string;
  summaryLoading: boolean;
  assistQuestion: string;
  setAssistQuestion: (v: string) => void;
  assistSuggestions: AssistSuggestionItem[];
  assistCapturedScreenText: string;
  assistCapturedChars: number;
  assistBusy: boolean;
  assistError: string;
  refreshSummary: () => Promise<void>;
  generateAssistSuggestions: () => Promise<void>;
  clearAssistQuestion: () => void;
  copyAssistCommand: (command: string) => Promise<void>;
  insertAssistCommand: (command: string) => void;
  executeAssistCommand: (command: string) => void;
}

export function useCopilotState({
  activeTab,
  senderMapRef,
  focusTerminal,
  showNotice
}: UseCopilotStateOptions): UseCopilotStateReturn {
  const [sideTab, setSideTab] = useState<"summary" | "assist">("assist");
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);

  const [summaryContext, setSummaryContext] = useState("");
  const [summaryScreenText, setSummaryScreenText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [assistQuestion, setAssistQuestion] = useState("");
  const [assistSuggestions, setAssistSuggestions] = useState<AssistSuggestionItem[]>([]);
  const [assistCapturedScreenText, setAssistCapturedScreenText] = useState("");
  const [assistCapturedChars, setAssistCapturedChars] = useState(0);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState("");

  async function refreshSummary(): Promise<void> {
    if (!activeTab?.sessionId) {
      setSummaryContext("");
      setSummaryScreenText("");
      setSummaryError("No active tab");
      return;
    }
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const [context, screen] = await Promise.all([
        apiClient.getSessionContext(activeTab.sessionId),
        apiClient.getSessionScreenText(activeTab.sessionId)
      ]);
      setSummaryContext(JSON.stringify(context, null, 2));
      setSummaryScreenText(screen.text || "");
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Failed to load summary");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function generateAssistSuggestions(): Promise<void> {
    if (!activeTab?.sessionId) {
      setAssistError("No active tab");
      setAssistSuggestions([]);
      return;
    }
    setAssistBusy(true);
    setAssistError("");
    try {
      const response = await apiClient.createAssistSuggestions(activeTab.sessionId, {
        question: assistQuestion.trim() || undefined
      });
      setAssistCapturedScreenText(response.capturedScreenText || "");
      setAssistCapturedChars(response.capturedChars || 0);
      setAssistSuggestions(response.suggestions || []);
      if (!response.suggestions || response.suggestions.length === 0) {
        setAssistError("No suggestions generated");
      }
    } catch (error) {
      setAssistSuggestions([]);
      setAssistCapturedScreenText("");
      setAssistCapturedChars(0);
      setAssistError(error instanceof Error ? error.message : "Failed to generate suggestions");
    } finally {
      setAssistBusy(false);
    }
  }

  function clearAssistQuestion(): void {
    setAssistQuestion("");
    setAssistError("");
  }

  async function copyAssistCommand(command: string): Promise<void> {
    const payload = command.trim();
    if (!payload) {
      setAssistError("Command is empty");
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setAssistError("");
      showNotice("Command copied", "success", 1800);
    } catch {
      setAssistError("Copy failed in this browser context");
      showNotice("Copy failed in this browser context", "warn", 2400);
    }
  }

function sendAssistCommand(command: string, execute: boolean): void {
    if (!activeTab) {
      setAssistError("No active tab");
      return;
    }
    const payload = command.trim();
    if (!payload) {
      setAssistError("Command is empty");
      return;
    }
    const sender = senderMapRef.current?.get(activeTab.localId);
    if (!sender) {
      setAssistError("Active terminal is not ready");
      return;
    }
    const ok = sender(execute ? `${payload}\r` : payload);
    if (!ok) {
      setAssistError("Active terminal websocket is not connected");
      return;
    }
    focusTerminal(activeTab.localId);
    setAssistError("");
    showNotice(execute ? "Command executed in terminal" : "Command inserted into terminal", "success", 1800);
  }

  function insertAssistCommand(command: string): void {
    sendAssistCommand(command, false);
  }

  function executeAssistCommand(command: string): void {
    sendAssistCommand(command, true);
  }

  useEffect(() => {
    if (sideTab !== "summary" || !isCopilotOpen) {
      return;
    }
    void refreshSummary();
    const timer = window.setInterval(() => {
      void refreshSummary();
    }, COPILOT_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideTab, activeTab?.sessionId, isCopilotOpen]);

  useEffect(() => {
    setAssistSuggestions([]);
    setAssistCapturedScreenText("");
    setAssistCapturedChars(0);
    setAssistError("");
  }, [activeTab?.sessionId]);

  useEffect(() => {
    if (window.innerWidth > 900) {
      setIsCopilotOpen(true);
    }
  }, []);

  return {
    sideTab,
    setSideTab,
    isCopilotOpen,
    setIsCopilotOpen,
    summaryContext,
    summaryScreenText,
    summaryError,
    summaryLoading,
    assistQuestion,
    setAssistQuestion,
    assistSuggestions,
    assistCapturedScreenText,
    assistCapturedChars,
    assistBusy,
    assistError,
    refreshSummary,
    generateAssistSuggestions,
    clearAssistQuestion,
    copyAssistCommand,
    insertAssistCommand,
    executeAssistCommand
  };
}
