import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { COPILOT_REFRESH_MS } from "../config/env";
import { buildAssistSuggestions, type AssistSuggestion } from "../copilot/assistMock";
import { parseQuickCommand } from "../terminal/quickCommand";
import type { AgentRunResponse } from "../api/types";
import type { TerminalTab } from "../../features/tabs/useTabsStore";

function parseSelectedPaths(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface UseCopilotStateOptions {
  activeTab: TerminalTab | null;
  senderMapRef: React.RefObject<Map<string, (data: string) => boolean>>;
  focusTerminal: (localId: string) => void;
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
  setTabAgentRunId: (localId: string, runId: string | null) => void;
}

export interface UseCopilotStateReturn {
  sideTab: "summary" | "agent" | "assist";
  setSideTab: (tab: "summary" | "agent" | "assist") => void;
  isCopilotOpen: boolean;
  setIsCopilotOpen: React.Dispatch<React.SetStateAction<boolean>>;
  summaryContext: string;
  summaryScreenText: string;
  summaryError: string;
  summaryLoading: boolean;
  agentInstruction: string;
  setAgentInstruction: (v: string) => void;
  agentSelectedPaths: string;
  setAgentSelectedPaths: (v: string) => void;
  agentQuickCommand: string;
  setAgentQuickCommand: (v: string) => void;
  agentRun: AgentRunResponse | null;
  agentError: string;
  setAgentError: (v: string) => void;
  agentBusy: boolean;
  assistQuestion: string;
  setAssistQuestion: (v: string) => void;
  assistSuggestions: AssistSuggestion[];
  assistBusy: boolean;
  assistError: string;
  refreshSummary: () => Promise<{ summaryContext: string; summaryScreenText: string } | null>;
  refreshAgentRun: () => Promise<void>;
  startAgentRun: () => Promise<void>;
  approveAgentRun: (confirmRisk: boolean) => Promise<void>;
  abortAgentRun: () => Promise<void>;
  sendQuickCommand: () => void;
  generateAssistSuggestions: () => Promise<void>;
  insertAssistCommand: (command: string) => void;
}

export function useCopilotState({
  activeTab,
  senderMapRef,
  focusTerminal,
  showNotice,
  setTabAgentRunId
}: UseCopilotStateOptions): UseCopilotStateReturn {
  const [sideTab, setSideTab] = useState<"summary" | "agent" | "assist">("summary");
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);

  const [summaryContext, setSummaryContext] = useState("");
  const [summaryScreenText, setSummaryScreenText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentSelectedPaths, setAgentSelectedPaths] = useState("");
  const [agentQuickCommand, setAgentQuickCommand] = useState("");
  const [agentRun, setAgentRun] = useState<AgentRunResponse | null>(null);
  const [agentError, setAgentError] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  const [assistQuestion, setAssistQuestion] = useState("");
  const [assistSuggestions, setAssistSuggestions] = useState<AssistSuggestion[]>([]);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState("");

  async function refreshSummary(): Promise<{ summaryContext: string; summaryScreenText: string } | null> {
    if (!activeTab?.sessionId) {
      setSummaryContext("");
      setSummaryScreenText("");
      setSummaryError("No active tab");
      return null;
    }
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const [context, screen] = await Promise.all([
        apiClient.getSessionContext(activeTab.sessionId),
        apiClient.getSessionScreenText(activeTab.sessionId)
      ]);
      const nextSummaryContext = JSON.stringify(context, null, 2);
      const nextSummaryScreenText = screen.text || "";
      setSummaryContext(nextSummaryContext);
      setSummaryScreenText(nextSummaryScreenText);
      return {
        summaryContext: nextSummaryContext,
        summaryScreenText: nextSummaryScreenText
      };
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Failed to load summary");
      return null;
    } finally {
      setSummaryLoading(false);
    }
  }

  async function refreshAgentRun(): Promise<void> {
    if (!activeTab?.sessionId || !activeTab.agentRunId) {
      setAgentRun(null);
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.getAgentRun(activeTab.sessionId, activeTab.agentRunId);
      setAgentRun(run);
      setTabAgentRunId(activeTab.localId, run.runId);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to refresh agent run");
    } finally {
      setAgentBusy(false);
    }
  }

  async function startAgentRun(): Promise<void> {
    if (!activeTab?.sessionId) {
      setAgentError("No active tab");
      return;
    }
    const instruction = agentInstruction.trim();
    if (!instruction) {
      setAgentError("Instruction is required");
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.createAgentRun(activeTab.sessionId, {
        instruction,
        selectedPaths: parseSelectedPaths(agentSelectedPaths),
        includeGitDiff: true
      });
      setAgentRun(run);
      setTabAgentRunId(activeTab.localId, run.runId);
      showNotice(`Agent run created: ${run.runId}`, "success", 2200);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to create agent run");
    } finally {
      setAgentBusy(false);
    }
  }

  async function approveAgentRun(confirmRisk: boolean): Promise<void> {
    if (!activeTab?.sessionId || !activeTab.agentRunId) {
      setAgentError("No active run for current tab");
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.approveAgentRun(activeTab.sessionId, activeTab.agentRunId, { confirmRisk });
      setAgentRun(run);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to approve run");
    } finally {
      setAgentBusy(false);
    }
  }

  async function abortAgentRun(): Promise<void> {
    if (!activeTab?.sessionId || !activeTab.agentRunId) {
      setAgentError("No active run for current tab");
      return;
    }
    setAgentBusy(true);
    setAgentError("");
    try {
      const run = await apiClient.abortAgentRun(activeTab.sessionId, activeTab.agentRunId, { reason: "manual abort" });
      setAgentRun(run);
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : "Failed to abort run");
    } finally {
      setAgentBusy(false);
    }
  }

  function sendQuickCommand(): void {
    if (!activeTab) {
      setAgentError("No active tab");
      return;
    }
    const payload = parseQuickCommand(agentQuickCommand);
    if (!payload) {
      setAgentError("Quick command is empty");
      return;
    }
    const sender = senderMapRef.current?.get(activeTab.localId);
    if (!sender) {
      setAgentError("Active terminal is not ready");
      return;
    }
    const ok = sender(payload);
    if (!ok) {
      setAgentError("Active terminal websocket is not connected");
      return;
    }
    focusTerminal(activeTab.localId);
    setAgentQuickCommand("");
    setAgentError("");
  }

  async function generateAssistSuggestions(): Promise<void> {
    if (!activeTab?.sessionId) {
      setAssistError("No active tab");
      setAssistSuggestions([]);
      return;
    }
    const question = assistQuestion.trim();
    if (!question) {
      setAssistError("Question is required");
      setAssistSuggestions([]);
      return;
    }

    setAssistBusy(true);
    setAssistError("");
    try {
      const summary = await refreshSummary();
      if (!summary) {
        setAssistSuggestions([]);
        setAssistError("Failed to refresh summary");
        return;
      }
      const suggestions = buildAssistSuggestions(question, summary.summaryScreenText);
      setAssistSuggestions(suggestions);
      if (suggestions.length === 0) {
        setAssistError("No suggestions generated");
      }
    } finally {
      setAssistBusy(false);
    }
  }

  function insertAssistCommand(command: string): void {
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
    const ok = sender(payload);
    if (!ok) {
      setAssistError("Active terminal websocket is not connected");
      return;
    }
    focusTerminal(activeTab.localId);
    setAssistError("");
    showNotice("Command inserted into terminal", "success", 1800);
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
    if (sideTab !== "agent" || !isCopilotOpen) {
      return;
    }
    void refreshAgentRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideTab, activeTab?.sessionId, activeTab?.agentRunId, isCopilotOpen]);

  useEffect(() => {
    setAssistSuggestions([]);
    setAssistError("");
  }, [activeTab?.sessionId]);

  return {
    sideTab,
    setSideTab,
    isCopilotOpen,
    setIsCopilotOpen,
    summaryContext,
    summaryScreenText,
    summaryError,
    summaryLoading,
    agentInstruction,
    setAgentInstruction,
    agentSelectedPaths,
    setAgentSelectedPaths,
    agentQuickCommand,
    setAgentQuickCommand,
    agentRun,
    agentError,
    setAgentError,
    agentBusy,
    assistQuestion,
    setAssistQuestion,
    assistSuggestions,
    assistBusy,
    assistError,
    refreshSummary,
    refreshAgentRun,
    startAgentRun,
    approveAgentRun,
    abortAgentRun,
    sendQuickCommand,
    generateAssistSuggestions,
    insertAssistCommand
  };
}
