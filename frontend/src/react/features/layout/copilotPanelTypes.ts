import type {
  AssistSuggestionItem,
  CopilotAgentSummary,
  CopilotChatSummary,
  CopilotPlanTask
} from "../../shared/api/types";
import type {
  RunnerConversationItem,
  TerminalCommandReviewState
} from "../../shared/hooks/copilotTypes";

export interface SummaryProps {
  loading: boolean;
  error: string;
  context: string;
  screenText: string;
  onRefresh: () => void;
  onCopyContext: () => void;
  onCopyScreen: () => void;
}

export interface AssistProps {
  sessionId: string | null;
  selectedAgentKey: string;
  question: string;
  suggestions: AssistSuggestionItem[];
  capturedScreenText: string;
  capturedChars: number;
  busy: boolean;
  error: string;
  hasLastSubmittedQuestion: boolean;
  onQuestionChange: (value: string) => void;
  onGenerateSuggestions: () => void;
  onClearQuestion: () => void;
  onRestoreLastQuestion: () => void;
  onCopyCommand: (command: string) => void;
  onInsertCommand: (command: string) => void;
  onExecuteCommand: (command: string) => void;
}

export interface RunnerProps {
  selectedAgent: CopilotAgentSummary | null;
  prompt: string;
  busy: boolean;
  error: string;
  historyBusy: boolean;
  history: CopilotChatSummary[];
  chatId: string | null;
  conversation: RunnerConversationItem[];
  plan: CopilotPlanTask[];
  pendingReview: TerminalCommandReviewState | null;
  canRun: boolean;
  capabilityMessage: string;
  onPromptChange: (value: string) => void;
  onRefreshHistory: () => void;
  onSendMessage: () => void;
  onNewChat: () => void;
  onOpenChat: (chatId: string) => void;
  onApproveNext: () => void;
  onApproveAll: () => void;
  onReject: () => void;
}
