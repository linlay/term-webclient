import { type ChangeEvent, type KeyboardEvent } from "react";
import type { CopilotPlanTask } from "../../shared/api/types";
import type { RunnerProps } from "./copilotPanelTypes";

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

export function RunnerPanel({
  selectedAgent,
  prompt,
  busy,
  error,
  historyBusy,
  history,
  chatId,
  conversation,
  plan,
  pendingReview,
  canRun,
  capabilityMessage,
  onPromptChange,
  onRefreshHistory,
  onSendMessage,
  onNewChat,
  onOpenChat,
  onApproveNext,
  onApproveAll,
  onReject
}: RunnerProps): JSX.Element | null {
  if (selectedAgent?.type !== "runner_agent") {
    return null;
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
    onSendMessage();
  }

  return (
    <>
      {!canRun ? <div className="tree-status error">{capabilityMessage}</div> : null}
      {error ? <div className="tree-status error">{error}</div> : null}

      <div className="agent-actions-row">
        <button
          type="button"
          className="ghost-btn"
          data-testid="runner-new-chat"
          onClick={onNewChat}
        >
          New Chat
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={onRefreshHistory}
          disabled={historyBusy}
        >
          {historyBusy ? "Refreshing..." : "Refresh History"}
        </button>
      </div>

      <div className="runner-history-panel">
        <div className="field-label">Chat History</div>
        <div className="runner-history-list" data-testid="runner-history-list">
          {history.length === 0 ? (
            <div className="agent-run-status">
              {historyBusy ? "Loading chats..." : "No chat history for this agent."}
            </div>
          ) : (
            history.map((chat) => (
              <button
                key={chat.chatId}
                type="button"
                className={`runner-history-item ${chatId === chat.chatId ? "active" : ""}`}
                onClick={() => onOpenChat(chat.chatId)}
              >
                <span className="runner-history-name">{chat.chatName || chat.chatId}</span>
                <span className="runner-history-meta">{formatTimestamp(chat.updatedAt)}</span>
                <span className="runner-history-preview">{chat.lastRunContent || "Open chat"}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {plan.length > 0 ? (
        <div className="runner-plan-panel">
          <div className="field-label">Plan</div>
          <div className="agent-steps-list">
            {plan.map((task, index) => (
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

      {pendingReview ? (
        <div className="runner-review-panel" data-testid="runner-review-panel">
          <div className="field-label">Terminal Review</div>
          <div className="agent-run-status">{pendingReview.title}</div>
          {pendingReview.summary ? (
            <div className="runner-review-summary">{pendingReview.summary}</div>
          ) : null}
          <div className="runner-review-list">
            {pendingReview.commands.map((command) => (
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
              onClick={onApproveNext}
              disabled={pendingReview.submitting}
            >
              Approve Next
            </button>
            <button
              type="button"
              className="ghost-btn"
              data-testid="runner-approve-all"
              onClick={onApproveAll}
              disabled={pendingReview.submitting || !pendingReview.allowBatchApprove}
            >
              Approve All
            </button>
            <button
              type="button"
              className="ghost-btn"
              data-testid="runner-reject"
              onClick={onReject}
              disabled={pendingReview.submitting}
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      <div className="runner-conversation-panel">
        <div className="field-label">Conversation</div>
        <div className="runner-conversation-list" data-testid="runner-conversation">
          {conversation.length === 0 ? (
            <div className="agent-run-status">No messages yet.</div>
          ) : (
            conversation.map((item) => (
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
        value={prompt}
        onChange={(event) => onTextareaChange(event, onPromptChange)}
        onKeyDown={handleRunnerPromptKeyDown}
        placeholder="Describe the terminal task you want the agent to complete."
      />
      <div className="agent-actions-row">
        <button
          type="button"
          className="primary-btn"
          data-testid="runner-send-btn"
          onClick={onSendMessage}
          disabled={busy || !canRun}
        >
          {busy ? "Running..." : "Send"}
        </button>
      </div>
    </>
  );
}
