import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { apiClient } from "../api/client";
import type { AssistSuggestionItem, CopilotAgentSummary, CopilotChatSummary, CopilotPlanTask } from "../api/types";
import type { TerminalTab } from "../../features/tabs/useTabsStore";
import type { RunnerConversationItem, SideTab, TerminalCommandReviewState } from "./copilotTypes";
import { useAssistState } from "./useAssistState";
import { useRunnerState } from "./useRunnerState";
import { useSummaryState } from "./useSummaryState";

export interface UseCopilotStateOptions {
  activeTab: TerminalTab | null;
  senderMapRef: RefObject<Map<string, (data: string) => boolean>>;
  focusTerminal: (localId: string) => void;
  showNotice: (message: string, type?: "info" | "warn" | "error" | "success", timeoutMs?: number) => void;
}

export interface UseCopilotStateReturn {
  sideTab: SideTab;
  setSideTab: (tab: SideTab) => void;
  isCopilotOpen: boolean;
  setIsCopilotOpen: Dispatch<SetStateAction<boolean>>;
  summaryContext: string;
  summaryScreenText: string;
  summaryError: string;
  summaryLoading: boolean;
  agents: CopilotAgentSummary[];
  selectedAgentKey: string;
  selectedAgent: CopilotAgentSummary | null;
  selectAgent: (agentKey: string) => void;
  assistQuestion: string;
  setAssistQuestion: (v: string) => void;
  assistSuggestions: AssistSuggestionItem[];
  assistCapturedScreenText: string;
  assistCapturedChars: number;
  assistBusy: boolean;
  assistError: string;
  lastSubmittedAssistQuestion: string;
  runnerPrompt: string;
  setRunnerPrompt: (value: string) => void;
  runnerBusy: boolean;
  runnerError: string;
  runnerHistoryBusy: boolean;
  runnerHistory: CopilotChatSummary[];
  runnerChatId: string | null;
  runnerConversation: RunnerConversationItem[];
  runnerPlan: CopilotPlanTask[];
  runnerPendingReview: TerminalCommandReviewState | null;
  runnerCanRun: boolean;
  runnerCapabilityMessage: string;
  refreshSummary: () => Promise<void>;
  generateAssistSuggestions: () => Promise<void>;
  clearAssistQuestion: () => void;
  restoreLastAssistQuestion: () => void;
  copyAssistCommand: (command: string) => Promise<void>;
  insertAssistCommand: (command: string) => void;
  executeAssistCommand: (command: string) => void;
  refreshRunnerHistory: () => Promise<void>;
  sendRunnerMessage: () => Promise<void>;
  startNewRunnerChat: () => void;
  openRunnerChat: (chatId: string) => Promise<void>;
  approveNextReviewCommand: () => Promise<void>;
  approveAllReviewCommands: () => Promise<void>;
  rejectReviewCommands: () => Promise<void>;
}

const runnerCapabilityMessage = "Runner agents require a shell or SSH terminal tab.";

export function useCopilotState({
  activeTab,
  senderMapRef,
  focusTerminal,
  showNotice
}: UseCopilotStateOptions): UseCopilotStateReturn {
  const [sideTab, setSideTab] = useState<SideTab>("agent");
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [agents, setAgents] = useState<CopilotAgentSummary[]>([]);
  const [selectedAgentKey, setSelectedAgentKey] = useState("");

  const selectedAgent = agents.find((agent) => agent.key === selectedAgentKey) ?? null;
  const summary = useSummaryState({ activeTab, isCopilotOpen, sideTab });
  const assist = useAssistState({ activeTab, senderMapRef, focusTerminal, showNotice });
  const runner = useRunnerState({ activeTab, selectedAgent, showNotice });

  async function refreshAgents(): Promise<void> {
    if (!activeTab?.sessionId) {
      setAgents([]);
      setSelectedAgentKey("");
      return;
    }
    runner.clearRunnerError();
    try {
      const response = await apiClient.listCopilotAgents(activeTab.sessionId);
      setAgents(response);
      const fallback = response.find((item) => item.default)?.key || response[0]?.key || "";
      setSelectedAgentKey((current) => (response.some((item) => item.key === current) ? current : fallback));
    } catch (error) {
      runner.clearRunnerError();
      setAgents([]);
      setSelectedAgentKey("");
    }
  }

  function selectAgent(agentKey: string): void {
    if (agentKey === selectedAgentKey) {
      return;
    }
    setSelectedAgentKey(agentKey);
    runner.clearRunnerError();
    runner.resetRunnerState(false);
  }

  useEffect(() => {
    runner.resetRunnerState(true);
    void refreshAgents();
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
    summaryContext: summary.summaryContext,
    summaryScreenText: summary.summaryScreenText,
    summaryError: summary.summaryError,
    summaryLoading: summary.summaryLoading,
    agents,
    selectedAgentKey,
    selectedAgent,
    selectAgent,
    assistQuestion: assist.assistQuestion,
    setAssistQuestion: assist.setAssistQuestion,
    assistSuggestions: assist.assistSuggestions,
    assistCapturedScreenText: assist.assistCapturedScreenText,
    assistCapturedChars: assist.assistCapturedChars,
    assistBusy: assist.assistBusy,
    assistError: assist.assistError,
    lastSubmittedAssistQuestion: assist.lastSubmittedAssistQuestion,
    runnerPrompt: runner.runnerPrompt,
    setRunnerPrompt: runner.setRunnerPrompt,
    runnerBusy: runner.runnerBusy,
    runnerError: runner.runnerError,
    runnerHistoryBusy: runner.runnerHistoryBusy,
    runnerHistory: runner.runnerHistory,
    runnerChatId: runner.runnerChatId,
    runnerConversation: runner.runnerConversation,
    runnerPlan: runner.runnerPlan,
    runnerPendingReview: runner.runnerPendingReview,
    runnerCanRun: runner.runnerCanRun,
    runnerCapabilityMessage,
    refreshSummary: summary.refreshSummary,
    generateAssistSuggestions: assist.generateAssistSuggestions,
    clearAssistQuestion: assist.clearAssistQuestion,
    restoreLastAssistQuestion: assist.restoreLastAssistQuestion,
    copyAssistCommand: assist.copyAssistCommand,
    insertAssistCommand: assist.insertAssistCommand,
    executeAssistCommand: assist.executeAssistCommand,
    refreshRunnerHistory: runner.refreshRunnerHistory,
    sendRunnerMessage: runner.sendRunnerMessage,
    startNewRunnerChat: runner.startNewRunnerChat,
    openRunnerChat: runner.openRunnerChat,
    approveNextReviewCommand: runner.approveNextReviewCommand,
    approveAllReviewCommands: runner.approveAllReviewCommands,
    rejectReviewCommands: runner.rejectReviewCommands
  };
}
