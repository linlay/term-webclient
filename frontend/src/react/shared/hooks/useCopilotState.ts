import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { COPILOT_REFRESH_MS } from "../config/env";
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
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
  setTabAgentRunId: (localId: string, runId: string | null) => void;
}

export interface UseCopilotStateReturn {
  sideTab: "summary" | "agent";
  setSideTab: (tab: "summary" | "agent") => void;
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
  refreshSummary: () => Promise<void>;
  refreshAgentRun: () => Promise<void>;
  startAgentRun: () => Promise<void>;
  approveAgentRun: (confirmRisk: boolean) => Promise<void>;
  abortAgentRun: () => Promise<void>;
  sendQuickCommand: () => void;
}

export function useCopilotState({
  activeTab,
  senderMapRef,
  showNotice,
  setTabAgentRunId
}: UseCopilotStateOptions): UseCopilotStateReturn {
  const [sideTab, setSideTab] = useState<"summary" | "agent">("summary");
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
    setAgentQuickCommand("");
    setAgentError("");
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
    refreshSummary,
    refreshAgentRun,
    startAgentRun,
    approveAgentRun,
    abortAgentRun,
    sendQuickCommand
  };
}
