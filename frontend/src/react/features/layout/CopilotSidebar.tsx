import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type {
  AssistSuggestionItem,
  CopilotAgentSummary,
  CopilotChatSummary,
  CopilotPlanTask
} from "../../shared/api/types";
import type {
  RunnerConversationItem,
  TerminalCommandReviewState
} from "../../shared/hooks/useCopilotState";

interface CopilotSidebarProps {
  open: boolean;
  isMobile: boolean;
  sideTab: "summary" | "agent";
  sessionId: string | null;
  summaryLoading: boolean;
  summaryError: string;
  summaryContext: string;
  summaryScreenText: string;
  agents: CopilotAgentSummary[];
  selectedAgentKey: string;
  selectedAgent: CopilotAgentSummary | null;
  assistQuestion: string;
  assistSuggestions: AssistSuggestionItem[];
  assistCapturedScreenText: string;
  assistCapturedChars: number;
  assistBusy: boolean;
  assistError: string;
  runnerPrompt: string;
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
  onTabChange: (tab: "summary" | "agent") => void;
  onRefreshSummary: () => void;
  onCopySummaryContext: () => void;
  onCopySummaryScreen: () => void;
  onSelectAgent: (agentKey: string) => void;
  onAssistQuestionChange: (value: string) => void;
  onGenerateAssistSuggestions: () => void;
  onClearAssistQuestion: () => void;
  onCopyAssistCommand: (command: string) => void;
  onInsertAssistCommand: (command: string) => void;
  onExecuteAssistCommand: (command: string) => void;
  onRunnerPromptChange: (value: string) => void;
  onRefreshRunnerHistory: () => void;
  onSendRunnerMessage: () => void;
  onNewRunnerChat: () => void;
  onOpenRunnerChat: (chatId: string) => void;
  onApproveNextReviewCommand: () => void;
  onApproveAllReviewCommands: () => void;
  onRejectReviewCommands: () => void;
  onClose: () => void;
}

function onTextareaChange(event: ChangeEvent<HTMLTextAreaElement>, setter: (value: string) => void): void {
  setter(event.target.value);
}

function formatTimestamp(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function renderPlanLabel(task: CopilotPlanTask, index: number): string {
  const title = typeof task.title === "string" && task.title.trim() ? task.title.trim() : `Step ${index + 1}`;
  const status = typeof task.status === "string" && task.status.trim() ? task.status.trim() : "pending";
  return `${title} [${status}]`;
}

export function CopilotSidebar({
  open,
  isMobile,
  sideTab,
  sessionId,
  summaryLoading,
  summaryError,
  summaryContext,
  summaryScreenText,
  agents,
  selectedAgentKey,
  selectedAgent,
  assistQuestion,
  assistSuggestions,
  assistCapturedScreenText,
  assistCapturedChars,
  assistBusy,
  assistError,
  runnerPrompt,
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
  onTabChange,
  onRefreshSummary,
  onCopySummaryContext,
  onCopySummaryScreen,
  onSelectAgent,
  onAssistQuestionChange,
  onGenerateAssistSuggestions,
  onClearAssistQuestion,
  onCopyAssistCommand,
  onInsertAssistCommand,
  onExecuteAssistCommand,
  onRunnerPromptChange,
  onRefreshRunnerHistory,
  onSendRunnerMessage,
  onNewRunnerChat,
  onOpenRunnerChat,
  onApproveNextReviewCommand,
  onApproveAllReviewCommands,
  onRejectReviewCommands,
  onClose
}: CopilotSidebarProps): JSX.Element {
  const [showRecentScreenText, setShowRecentScreenText] = useState(false);

  useEffect(() => {
    if (sideTab === "agent") {
      setShowRecentScreenText(false);
    }
  }, [sideTab, sessionId, selectedAgentKey]);

  function handleAssistQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const isComposing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (isComposing) {
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    onGenerateAssistSuggestions();
  }

  function handleRunnerPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const isComposing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (isComposing) {
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    onSendRunnerMessage();
  }

  const showBuiltinAssist = selectedAgent?.type === "builtin_assist";
  const showRunnerAgent = selectedAgent?.type === "runner_agent";

  return (
    <aside
      className={`agent-sidebar ${isMobile ? "mobile-sheet" : ""} ${open ? "" : "hidden"}`}
      aria-hidden={open ? "false" : "true"}
      data-testid="copilot-sidebar"
    >
      {isMobile && <div className="copilot-sheet-handle" aria-hidden="true" />}
      <div className="agent-header">
        <div className="agent-title">Copilot</div>
        <button
          type="button"
          className="ghost-btn copilot-close-btn"
          aria-label="Close Copilot"
          title="Close Copilot"
          onClick={onClose}
        >
          x
        </button>
      </div>
      <div className="copilot-tabs">
        <button
          type="button"
          className={`ghost-btn copilot-tab ${sideTab === "agent" ? "active" : ""}`}
          onClick={() => onTabChange("agent")}
        >
          Agent
        </button>
        <button
          type="button"
          className={`ghost-btn copilot-tab ${sideTab === "summary" ? "active" : ""}`}
          onClick={() => onTabChange("summary")}
        >
          Summary
        </button>
      </div>

      <div className="agent-session">Session: <code>{sessionId || "-"}</code></div>

      {sideTab === "agent" ? (
        <section className="copilot-panel">
          <div className="copilot-agent-select-wrap">
            <label className="field-label" htmlFor="copilotAgentSelect">Agent</label>
            <select
              id="copilotAgentSelect"
              data-testid="copilot-agent-select"
              value={selectedAgentKey}
              onChange={(event) => onSelectAgent(event.target.value)}
              disabled={agents.length === 0}
            >
              {agents.length === 0 ? (
                <option value="">No agents</option>
              ) : null}
              {agents.map((agent) => (
                <option key={agent.key} value={agent.key}>
                  {agent.label}
                </option>
              ))}
            </select>
            {selectedAgent ? (
              <div className="copilot-agent-meta">
                <div className="copilot-agent-chip-row">
                  <span className={`copilot-agent-kind ${selectedAgent.type}`}>
                    {selectedAgent.type === "builtin_assist" ? "Builtin Assist" : "Runner Agent"}
                  </span>
                  {selectedAgent.default ? <span className="copilot-agent-default">Default</span> : null}
                </div>
                {selectedAgent.description ? (
                  <div className="agent-run-status">{selectedAgent.description}</div>
                ) : null}
              </div>
            ) : (
              <div className="agent-run-status">No agent available for the current session.</div>
            )}
          </div>

          {showBuiltinAssist ? (
            <>
              <label className="field-label" htmlFor="assistQuestionInput">Question (Optional)</label>
              <textarea
                id="assistQuestionInput"
                rows={2}
                value={assistQuestion}
                onChange={(event) => onTextareaChange(event, onAssistQuestionChange)}
                onKeyDown={handleAssistQuestionKeyDown}
                placeholder="Describe what you want to inspect, or leave empty and let AI infer from recent screen text."
              />

              <div className="agent-actions-row">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={onGenerateAssistSuggestions}
                  disabled={assistBusy}
                >
                  {assistBusy ? "Generating..." : "生成建议"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={onClearAssistQuestion}
                  disabled={!assistQuestion.trim()}
                >
                  清空
                </button>
              </div>

              {assistError && <div className="tree-status error">{assistError}</div>}

              <div className="assist-screen-toggle-row">
                <button
                  type="button"
                  className="ghost-btn assist-screen-toggle"
                  data-testid="assist-screen-toggle"
                  onClick={() => setShowRecentScreenText((prev) => !prev)}
                >
                  {showRecentScreenText ? "收起" : "展开"} Recent Screen Text
                  {assistCapturedChars > 0 ? ` (${assistCapturedChars} chars)` : ""}
                </button>
              </div>

              {showRecentScreenText ? (
                <textarea
                  data-testid="assist-screen-text"
                  className="summary-text assist-screen-preview"
                  rows={6}
                  readOnly
                  value={assistCapturedScreenText}
                  placeholder="Recent screen text will appear here after generation."
                />
              ) : null}

              <div className="assist-suggestion-list" data-testid="assist-suggestion-list">
                {assistSuggestions.length === 0 ? (
                  <div className="agent-run-status">No suggestions yet</div>
                ) : (
                  assistSuggestions.map((suggestion) => (
                    <article key={suggestion.id} className="assist-suggestion-card">
                      <div className="assist-suggestion-main">
                        <div className="assist-suggestion-meta">
                          <span className="assist-suggestion-weight">Weight {suggestion.weight}</span>
                        </div>
                        <code className="assist-suggestion-command">{suggestion.command}</code>
                        <div className="assist-suggestion-reason">{suggestion.reason}</div>
                      </div>
                      <div className="assist-suggestion-actions">
                        <button
                          type="button"
                          className="ghost-btn assist-icon-btn"
                          aria-label="复制"
                          title="复制"
                          data-testid="assist-copy-btn"
                          onClick={() => onCopyAssistCommand(suggestion.command)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="ghost-btn assist-icon-btn"
                          aria-label="写入"
                          title="写入"
                          data-testid="assist-insert-btn"
                          onClick={() => onInsertAssistCommand(suggestion.command)}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 19V5" />
                            <path d="m5 12 7 7 7-7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                          data-testid="assist-execute-btn"
                          onClick={() => onExecuteAssistCommand(suggestion.command)}
                        >
                          执行
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          ) : null}

          {showRunnerAgent ? (
            <>
              {!runnerCanRun ? <div className="tree-status error">{runnerCapabilityMessage}</div> : null}
              {runnerError ? <div className="tree-status error">{runnerError}</div> : null}

              <div className="agent-actions-row">
                <button
                  type="button"
                  className="ghost-btn"
                  data-testid="runner-new-chat"
                  onClick={onNewRunnerChat}
                >
                  New Chat
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={onRefreshRunnerHistory}
                  disabled={runnerHistoryBusy}
                >
                  {runnerHistoryBusy ? "Refreshing..." : "Refresh History"}
                </button>
              </div>

              <div className="runner-history-panel">
                <div className="field-label">Chat History</div>
                <div className="runner-history-list" data-testid="runner-history-list">
                  {runnerHistory.length === 0 ? (
                    <div className="agent-run-status">
                      {runnerHistoryBusy ? "Loading chats..." : "No chat history for this agent."}
                    </div>
                  ) : (
                    runnerHistory.map((chat) => (
                      <button
                        key={chat.chatId}
                        type="button"
                        className={`runner-history-item ${runnerChatId === chat.chatId ? "active" : ""}`}
                        onClick={() => onOpenRunnerChat(chat.chatId)}
                      >
                        <span className="runner-history-name">{chat.chatName || chat.chatId}</span>
                        <span className="runner-history-meta">{formatTimestamp(chat.updatedAt)}</span>
                        <span className="runner-history-preview">{chat.lastRunContent || "Open chat"}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {runnerPlan.length > 0 ? (
                <div className="runner-plan-panel">
                  <div className="field-label">Plan</div>
                  <div className="agent-steps-list">
                    {runnerPlan.map((task, index) => (
                      <div key={task.taskId || `task-${index + 1}`} className="agent-step-item">
                        <div className="agent-step-head">
                          <span>{renderPlanLabel(task, index)}</span>
                        </div>
                        {typeof task.description === "string" && task.description.trim() ? (
                          <div className="agent-step-body">{task.description}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {runnerPendingReview ? (
                <div className="runner-review-panel" data-testid="runner-review-panel">
                  <div className="field-label">Terminal Review</div>
                  <div className="agent-run-status">{runnerPendingReview.title}</div>
                  {runnerPendingReview.summary ? (
                    <div className="runner-review-summary">{runnerPendingReview.summary}</div>
                  ) : null}
                  <div className="runner-review-list">
                    {runnerPendingReview.commands.map((command) => (
                      <article
                        key={command.id}
                        className={`runner-review-card ${command.highRisk ? "high-risk" : ""} ${command.status}`}
                      >
                        <div className="runner-review-card-head">
                          <span>{command.title}</span>
                          <span className="runner-review-status">{command.status}</span>
                        </div>
                        <code className="runner-review-command">{command.command}</code>
                        {command.reason ? <div className="runner-review-reason">{command.reason}</div> : null}
                        {command.error ? <div className="tree-status error">{command.error}</div> : null}
                        {command.outputExcerpt ? (
                          <textarea
                            className="summary-text runner-review-output"
                            rows={4}
                            readOnly
                            value={command.outputExcerpt}
                          />
                        ) : null}
                      </article>
                    ))}
                  </div>
                  <div className="agent-actions-row">
                    <button
                      type="button"
                      className="primary-btn"
                      data-testid="runner-approve-next"
                      onClick={onApproveNextReviewCommand}
                      disabled={runnerPendingReview.submitting}
                    >
                      Approve Next
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      data-testid="runner-approve-all"
                      onClick={onApproveAllReviewCommands}
                      disabled={runnerPendingReview.submitting || !runnerPendingReview.allowBatchApprove}
                    >
                      Approve All
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      data-testid="runner-reject"
                      onClick={onRejectReviewCommands}
                      disabled={runnerPendingReview.submitting}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="runner-conversation-panel">
                <div className="field-label">Conversation</div>
                <div className="runner-conversation-list" data-testid="runner-conversation">
                  {runnerConversation.length === 0 ? (
                    <div className="agent-run-status">No messages yet.</div>
                  ) : (
                    runnerConversation.map((item) => (
                      <article key={item.id} className={`runner-message ${item.role}`}>
                        <div className="runner-message-role">{item.role}</div>
                        <div className="runner-message-text">{item.text}</div>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <label className="field-label" htmlFor="runnerPromptInput">Message</label>
              <textarea
                id="runnerPromptInput"
                rows={3}
                value={runnerPrompt}
                onChange={(event) => onTextareaChange(event, onRunnerPromptChange)}
                onKeyDown={handleRunnerPromptKeyDown}
                placeholder="Describe the terminal task you want the agent to complete."
              />
              <div className="agent-actions-row">
                <button
                  type="button"
                  className="primary-btn"
                  data-testid="runner-send-btn"
                  onClick={onSendRunnerMessage}
                  disabled={runnerBusy || !runnerCanRun}
                >
                  {runnerBusy ? "Running..." : "Send"}
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {sideTab === "summary" ? (
        <section className="copilot-panel">
          <div className="summary-actions">
            <button type="button" className="ghost-btn" onClick={onRefreshSummary} disabled={summaryLoading}>
              {summaryLoading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="ghost-btn" onClick={onCopySummaryContext}>Copy Context JSON</button>
            <button type="button" className="ghost-btn" onClick={onCopySummaryScreen}>Copy Screen Text</button>
          </div>

          {summaryError && <div className="tree-status error">{summaryError}</div>}

          <label className="field-label" htmlFor="sessionSummaryContextText">Structured Context</label>
          <textarea id="sessionSummaryContextText" className="summary-text" rows={8} readOnly value={summaryContext} />

          <label className="field-label" htmlFor="sessionSummaryScreenText">Screen Text</label>
          <textarea id="sessionSummaryScreenText" className="summary-text" rows={8} readOnly value={summaryScreenText} />
        </section>
      ) : null}
    </aside>
  );
}
