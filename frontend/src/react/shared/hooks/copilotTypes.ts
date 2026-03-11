export type SideTab = "summary" | "agent";
export type ReviewCommandStatus = "pending" | "executing" | "completed" | "failed";

export interface RunnerConversationItem {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface TerminalReviewCommand {
  id: string;
  title: string;
  command: string;
  reason: string;
  highRisk: boolean;
  status: ReviewCommandStatus;
  exitCode: number | null;
  outputExcerpt: string;
  transcriptDelta: string;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TerminalCommandReviewState {
  runId: string;
  toolId: string;
  title: string;
  summary: string;
  allowBatchApprove: boolean;
  commands: TerminalReviewCommand[];
  submitting: boolean;
}
