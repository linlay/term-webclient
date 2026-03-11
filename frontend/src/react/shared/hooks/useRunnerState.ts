import { useEffect, useRef, useState } from "react";
import type { TerminalTab } from "../../features/tabs/useTabsStore";
import { apiClient } from "../api/client";
import type {
  CopilotAgentSummary,
  CopilotChatSummary,
  CopilotEventEnvelope,
  CopilotPlanTask
} from "../api/types";
import { isShellCapableTab } from "../utils/toolId";
import type {
  RunnerConversationItem,
  TerminalCommandReviewState,
  TerminalReviewCommand
} from "./copilotTypes";

const runnerCapabilityMessage = "Runner agents require a shell or SSH terminal tab.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readCommands(value: unknown): TerminalReviewCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const commands: TerminalReviewCommand[] = [];
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }
    const command = readString(item.command).trim();
    if (!command) {
      return;
    }
    commands.push({
      id: readString(item.id, `cmd-${index + 1}`),
      title: readString(item.title, `Step ${index + 1}`),
      command,
      reason: readString(item.reason),
      highRisk: readBoolean(item.highRisk),
      status: "pending",
      exitCode: null,
      outputExcerpt: "",
      transcriptDelta: "",
      error: null,
      startedAt: null,
      completedAt: null
    });
  });
  return commands;
}

function parseTerminalCommandReview(event: CopilotEventEnvelope): TerminalCommandReviewState | null {
  if ((event.type !== "tool.start" && event.type !== "tool.snapshot") || event.toolKey !== "terminal_command_review") {
    return null;
  }
  const toolParams = isRecord(event.toolParams) ? event.toolParams : {};
  const commands = readCommands(toolParams.commands);
  return {
    runId: readString(event.runId),
    toolId: readString(event.toolId),
    title: readString(toolParams.title, "Terminal Review"),
    summary: readString(toolParams.summary || toolParams.goal || toolParams.description),
    allowBatchApprove: readBoolean(toolParams.allowBatchApprove, true),
    commands,
    submitting: false
  };
}

function buildRunnerConversation(events: CopilotEventEnvelope[]): RunnerConversationItem[] {
  const items: RunnerConversationItem[] = [];
  const contentIndexById = new Map<string, number>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "request.query" || event.type === "request.submit") {
      const text = readString(event.message).trim();
      if (text) {
        items.push({
          id: `user-${event.requestId || event.seq || index}`,
          role: "user",
          text
        });
      }
      continue;
    }
    if (event.type === "content.delta" || event.type === "content.snapshot") {
      const contentId = readString(event.contentId, `assistant-${index}`);
      const chunk = event.type === "content.snapshot" ? readString(event.text) : readString(event.delta);
      if (!chunk) {
        continue;
      }
      const existingIndex = contentIndexById.get(contentId);
      if (existingIndex === undefined) {
        contentIndexById.set(contentId, items.length);
        items.push({
          id: contentId,
          role: "assistant",
          text: chunk
        });
      } else if (event.type === "content.snapshot") {
        items[existingIndex] = { ...items[existingIndex], text: chunk };
      } else {
        items[existingIndex] = { ...items[existingIndex], text: items[existingIndex].text + chunk };
      }
    }
  }
  return items;
}

function buildRunnerPlan(events: CopilotEventEnvelope[]): CopilotPlanTask[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "plan.update" && Array.isArray(event.plan)) {
      return event.plan;
    }
  }
  return [];
}

interface UseRunnerStateOptions {
  activeTab: TerminalTab | null;
  selectedAgent: CopilotAgentSummary | null;
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
}

export function useRunnerState({ activeTab, selectedAgent, showNotice }: UseRunnerStateOptions) {
  const [runnerPrompt, setRunnerPrompt] = useState("");
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [runnerError, setRunnerError] = useState("");
  const [runnerHistoryBusy, setRunnerHistoryBusy] = useState(false);
  const [runnerHistory, setRunnerHistory] = useState<CopilotChatSummary[]>([]);
  const [runnerChatId, setRunnerChatId] = useState<string | null>(null);
  const [runnerConversation, setRunnerConversation] = useState<RunnerConversationItem[]>([]);
  const [runnerPlan, setRunnerPlan] = useState<CopilotPlanTask[]>([]);
  const [runnerPendingReview, setRunnerPendingReview] = useState<TerminalCommandReviewState | null>(null);

  const streamAbortRef = useRef<AbortController | null>(null);
  const runnerEventsRef = useRef<CopilotEventEnvelope[]>([]);
  const pendingReviewRef = useRef<TerminalCommandReviewState | null>(null);

  const runnerCanRun = isShellCapableTab(activeTab);

  function syncRunnerState(events: CopilotEventEnvelope[]): void {
    setRunnerConversation(buildRunnerConversation(events));
    setRunnerPlan(buildRunnerPlan(events));
  }

  function replaceRunnerEvents(events: CopilotEventEnvelope[]): void {
    runnerEventsRef.current = events;
    syncRunnerState(events);
  }

  function updatePendingReview(nextValue: TerminalCommandReviewState | null): void {
    pendingReviewRef.current = nextValue;
    setRunnerPendingReview(nextValue);
  }

  function resetRunnerState(clearHistory: boolean): void {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setRunnerPrompt("");
    setRunnerBusy(false);
    setRunnerError("");
    setRunnerChatId(null);
    replaceRunnerEvents([]);
    updatePendingReview(null);
    if (clearHistory) {
      setRunnerHistory([]);
    }
  }

  function clearRunnerError(): void {
    setRunnerError("");
  }

  async function refreshRunnerHistory(): Promise<void> {
    if (!activeTab?.sessionId || !selectedAgent || selectedAgent.type !== "runner_agent") {
      setRunnerHistory([]);
      return;
    }
    setRunnerHistoryBusy(true);
    try {
      const response = await apiClient.listCopilotChats(activeTab.sessionId, selectedAgent.key);
      setRunnerHistory(response);
    } catch (error) {
      setRunnerError(error instanceof Error ? error.message : "Failed to load runner history");
    } finally {
      setRunnerHistoryBusy(false);
    }
  }

  function applyRunnerEvent(event: CopilotEventEnvelope): void {
    replaceRunnerEvents([...runnerEventsRef.current, event]);
    if (typeof event.chatId === "string" && event.chatId.trim() && (event.type === "chat.start" || event.type === "run.start")) {
      setRunnerChatId(event.chatId);
    }
    const review = parseTerminalCommandReview(event);
    if (review) {
      updatePendingReview(review);
    }
    if (event.type === "tool.result" && pendingReviewRef.current?.toolId === event.toolId) {
      updatePendingReview(null);
    }
    if (event.type === "run.complete") {
      void refreshRunnerHistory();
    }
  }

  async function sendRunnerMessage(): Promise<void> {
    if (!activeTab?.sessionId) {
      setRunnerError("No active tab");
      return;
    }
    if (!selectedAgent || selectedAgent.type !== "runner_agent") {
      setRunnerError("Select a runner agent");
      return;
    }
    if (!runnerCanRun) {
      setRunnerError(runnerCapabilityMessage);
      return;
    }
    if (!runnerPrompt.trim()) {
      setRunnerError("Message is empty");
      return;
    }

    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    setRunnerBusy(true);
    setRunnerError("");
    const message = runnerPrompt.trim();
    setRunnerPrompt("");
    try {
      await apiClient.streamCopilotQuery(
        activeTab.sessionId,
        {
          agentKey: selectedAgent.key,
          chatId: runnerChatId,
          message
        },
        {
          signal: controller.signal,
          onEvent: applyRunnerEvent
        }
      );
      await refreshRunnerHistory();
    } catch (error) {
      if (!controller.signal.aborted) {
        setRunnerError(error instanceof Error ? error.message : "Failed to send runner message");
      }
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
      }
      setRunnerBusy(false);
    }
  }

  function startNewRunnerChat(): void {
    resetRunnerState(false);
  }

  async function openRunnerChat(chatId: string): Promise<void> {
    if (!activeTab?.sessionId) {
      setRunnerError("No active tab");
      return;
    }
    setRunnerError("");
    try {
      const detail = await apiClient.getCopilotChat(activeTab.sessionId, chatId);
      setRunnerChatId(detail.chatId);
      replaceRunnerEvents(detail.events || []);
      updatePendingReview(null);
    } catch (error) {
      setRunnerError(error instanceof Error ? error.message : "Failed to load chat");
    }
  }

  function updateReviewCommand(
    commandId: string,
    updater: (command: TerminalReviewCommand) => TerminalReviewCommand
  ): void {
    updatePendingReview((() => {
      const current = pendingReviewRef.current;
      if (!current) {
        return null;
      }
      return {
        ...current,
        commands: current.commands.map((item) => (item.id === commandId ? updater(item) : item))
      };
    })());
  }

  async function executeReviewCommand(commandId: string): Promise<void> {
    const current = pendingReviewRef.current;
    if (!current || !activeTab?.sessionId) {
      return;
    }
    const target = current.commands.find((item) => item.id === commandId);
    if (!target || target.status !== "pending") {
      return;
    }
    updateReviewCommand(commandId, (item) => ({
      ...item,
      status: "executing",
      error: null
    }));
    try {
      const response = await apiClient.executeCopilotCommand(activeTab.sessionId, {
        command: target.command
      });
      updateReviewCommand(commandId, (item) => ({
        ...item,
        status: response.exitCode === 0 ? "completed" : "failed",
        exitCode: response.exitCode,
        outputExcerpt: response.outputExcerpt,
        transcriptDelta: response.transcriptDelta,
        startedAt: response.startedAt,
        completedAt: response.completedAt,
        error: response.exitCode === 0 ? null : `Exit code ${response.exitCode}`
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command execution failed";
      updateReviewCommand(commandId, (item) => ({
        ...item,
        status: "failed",
        error: message
      }));
    }
  }

  async function submitReview(approved: boolean): Promise<void> {
    const current = pendingReviewRef.current;
    if (!current || !activeTab?.sessionId) {
      return;
    }
    updatePendingReview({
      ...current,
      submitting: true
    });
    try {
      await apiClient.submitCopilotTool(activeTab.sessionId, {
        runId: current.runId,
        toolId: current.toolId,
        params: {
          approved,
          status: approved ? "completed" : "rejected",
          commandCount: current.commands.length,
          commands: current.commands.map((item) => ({
            id: item.id,
            title: item.title,
            command: item.command,
            reason: item.reason,
            highRisk: item.highRisk,
            status: item.status,
            exitCode: item.exitCode,
            outputExcerpt: item.outputExcerpt,
            transcriptDelta: item.transcriptDelta,
            error: item.error,
            startedAt: item.startedAt,
            completedAt: item.completedAt
          }))
        }
      });
      showNotice(approved ? "Submitted command review" : "Review rejected", "success", 1800);
      updatePendingReview(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit review";
      setRunnerError(message);
      updatePendingReview({
        ...current,
        submitting: false
      });
    }
  }

  async function approveNextReviewCommand(): Promise<void> {
    const current = pendingReviewRef.current;
    if (!current) {
      return;
    }
    const next = current.commands.find((item) => item.status === "pending");
    if (!next) {
      await submitReview(true);
      return;
    }
    await executeReviewCommand(next.id);
    const latest = pendingReviewRef.current;
    if (latest && latest.commands.every((item) => item.status !== "pending" && item.status !== "executing")) {
      await submitReview(true);
    }
  }

  async function approveAllReviewCommands(): Promise<void> {
    while (true) {
      const current = pendingReviewRef.current;
      const next = current?.commands.find((item) => item.status === "pending");
      if (!current || !next) {
        break;
      }
      await executeReviewCommand(next.id);
    }
    if (pendingReviewRef.current) {
      await submitReview(true);
    }
  }

  async function rejectReviewCommands(): Promise<void> {
    await submitReview(false);
  }

  useEffect(() => {
    if (!selectedAgent || selectedAgent.type !== "runner_agent") {
      setRunnerHistory([]);
      return;
    }
    void refreshRunnerHistory();
  }, [activeTab?.sessionId, selectedAgent?.key, selectedAgent?.type]);

  useEffect(() => {
    if (!runnerCanRun && selectedAgent?.type === "runner_agent") {
      setRunnerError(runnerCapabilityMessage);
    }
  }, [runnerCanRun, selectedAgent?.type]);

  useEffect(() => () => {
    streamAbortRef.current?.abort();
  }, []);

  return {
    runnerPrompt,
    setRunnerPrompt,
    runnerBusy,
    runnerError,
    runnerHistoryBusy,
    runnerHistory,
    runnerChatId,
    runnerConversation,
    runnerPlan,
    runnerPendingReview,
    runnerCanRun,
    runnerCapabilityMessage,
    resetRunnerState,
    clearRunnerError,
    refreshRunnerHistory,
    sendRunnerMessage,
    startNewRunnerChat,
    openRunnerChat,
    approveNextReviewCommand,
    approveAllReviewCommands,
    rejectReviewCommands
  };
}
