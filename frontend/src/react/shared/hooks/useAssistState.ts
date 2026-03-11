import { useEffect, useState, type RefObject } from "react";
import type { TerminalTab } from "../../features/tabs/useTabsStore";
import { apiClient } from "../api/client";
import type { AssistSuggestionItem } from "../api/types";

interface UseAssistStateOptions {
  activeTab: TerminalTab | null;
  senderMapRef: RefObject<Map<string, (data: string) => boolean>>;
  focusTerminal: (localId: string) => void;
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
}

export function useAssistState({
  activeTab,
  senderMapRef,
  focusTerminal,
  showNotice
}: UseAssistStateOptions) {
  const [assistQuestion, setAssistQuestion] = useState("");
  const [assistSuggestions, setAssistSuggestions] = useState<AssistSuggestionItem[]>([]);
  const [assistCapturedScreenText, setAssistCapturedScreenText] = useState("");
  const [assistCapturedChars, setAssistCapturedChars] = useState(0);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState("");
  const [lastSubmittedAssistQuestion, setLastSubmittedAssistQuestion] = useState("");

  function resetAssistState(): void {
    setAssistSuggestions([]);
    setAssistCapturedScreenText("");
    setAssistCapturedChars(0);
    setAssistError("");
    setLastSubmittedAssistQuestion("");
  }

  async function generateAssistSuggestions(): Promise<void> {
    if (!activeTab?.sessionId) {
      setAssistError("No active tab");
      setAssistSuggestions([]);
      return;
    }
    setAssistBusy(true);
    setAssistError("");
    const submittedQuestion = assistQuestion.trim();
    try {
      const response = await apiClient.createAssistSuggestions(activeTab.sessionId, {
        question: submittedQuestion || undefined
      });
      setAssistCapturedScreenText(response.capturedScreenText || "");
      setAssistCapturedChars(response.capturedChars || 0);
      setAssistSuggestions(response.suggestions || []);
      if (submittedQuestion) {
        setLastSubmittedAssistQuestion(submittedQuestion);
      }
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

  function restoreLastAssistQuestion(): void {
    if (!lastSubmittedAssistQuestion) {
      return;
    }
    setAssistQuestion(lastSubmittedAssistQuestion);
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
    if (execute) {
      setAssistQuestion("");
    }
    showNotice(execute ? "Command executed in terminal" : "Command inserted into terminal", "success", 1800);
  }

  function insertAssistCommand(command: string): void {
    sendAssistCommand(command, false);
  }

  function executeAssistCommand(command: string): void {
    sendAssistCommand(command, true);
  }

  useEffect(() => {
    resetAssistState();
  }, [activeTab?.sessionId]);

  return {
    assistQuestion,
    setAssistQuestion,
    assistSuggestions,
    assistCapturedScreenText,
    assistCapturedChars,
    assistBusy,
    assistError,
    lastSubmittedAssistQuestion,
    resetAssistState,
    generateAssistSuggestions,
    clearAssistQuestion,
    restoreLastAssistQuestion,
    copyAssistCommand,
    insertAssistCommand,
    executeAssistCommand
  };
}
