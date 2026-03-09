import type { ChangeEvent } from "react";
import type { AgentRunResponse } from "../../shared/api/types";
import type { AssistSuggestion } from "../../shared/copilot/assistMock";

interface CopilotSidebarProps {
  open: boolean;
  isMobile: boolean;
  sideTab: "summary" | "agent" | "assist";
  sessionId: string | null;
  summaryLoading: boolean;
  summaryError: string;
  summaryContext: string;
  summaryScreenText: string;
  agentBusy: boolean;
  agentError: string;
  agentInstruction: string;
  agentSelectedPaths: string;
  agentQuickCommand: string;
  agentRun: AgentRunResponse | null;
  assistQuestion: string;
  assistSuggestions: AssistSuggestion[];
  assistBusy: boolean;
  assistError: string;
  onTabChange: (tab: "summary" | "agent" | "assist") => void;
  onRefreshSummary: () => void;
  onCopySummaryContext: () => void;
  onCopySummaryScreen: () => void;
  onAgentInstructionChange: (value: string) => void;
  onAgentSelectedPathsChange: (value: string) => void;
  onAgentQuickCommandChange: (value: string) => void;
  onStartAgentRun: () => void;
  onRefreshAgentRun: () => void;
  onApproveAgentRun: (confirmRisk: boolean) => void;
  onAbortAgentRun: () => void;
  onSendQuickCommand: () => void;
  onAssistQuestionChange: (value: string) => void;
  onGenerateAssistSuggestions: () => void;
  onInsertAssistCommand: (command: string) => void;
  onClose: () => void;
}

function onTextareaChange(event: ChangeEvent<HTMLTextAreaElement>, setter: (value: string) => void): void {
  setter(event.target.value);
}

function onInputChange(event: ChangeEvent<HTMLInputElement>, setter: (value: string) => void): void {
  setter(event.target.value);
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
  agentBusy,
  agentError,
  agentInstruction,
  agentSelectedPaths,
  agentQuickCommand,
  agentRun,
  assistQuestion,
  assistSuggestions,
  assistBusy,
  assistError,
  onTabChange,
  onRefreshSummary,
  onCopySummaryContext,
  onCopySummaryScreen,
  onAgentInstructionChange,
  onAgentSelectedPathsChange,
  onAgentQuickCommandChange,
  onStartAgentRun,
  onRefreshAgentRun,
  onApproveAgentRun,
  onAbortAgentRun,
  onSendQuickCommand,
  onAssistQuestionChange,
  onGenerateAssistSuggestions,
  onInsertAssistCommand,
  onClose
}: CopilotSidebarProps): JSX.Element {
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
          className={`ghost-btn copilot-tab ${sideTab === "summary" ? "active" : ""}`}
          onClick={() => onTabChange("summary")}
        >
          Summary
        </button>
        <button
          type="button"
          className={`ghost-btn copilot-tab ${sideTab === "assist" ? "active" : ""}`}
          onClick={() => onTabChange("assist")}
        >
          Assist
        </button>
        <button
          type="button"
          className={`ghost-btn copilot-tab ${sideTab === "agent" ? "active" : ""}`}
          onClick={() => onTabChange("agent")}
        >
          Agent
        </button>
      </div>

      <div className="agent-session">Session: <code>{sessionId || "-"}</code></div>

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

      {sideTab === "assist" ? (
        <section className="copilot-panel">
          <label className="field-label" htmlFor="assistQuestionInput">Question</label>
          <textarea
            id="assistQuestionInput"
            rows={4}
            value={assistQuestion}
            onChange={(event) => onTextareaChange(event, onAssistQuestionChange)}
            placeholder="Describe what you want to inspect or do next."
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
          </div>

          {assistError && <div className="tree-status error">{assistError}</div>}

          <label className="field-label" htmlFor="assistScreenText">Recent Screen Text</label>
          <textarea
            id="assistScreenText"
            className="summary-text assist-screen-preview"
            rows={7}
            readOnly
            value={summaryScreenText}
            placeholder="Summary screen text will appear here after refresh."
          />

          <div className="assist-suggestion-list">
            {assistSuggestions.length === 0 ? (
              <div className="agent-run-status">No suggestions yet</div>
            ) : (
              assistSuggestions.map((suggestion) => (
                <article key={suggestion.id} className="assist-suggestion-card">
                  <div className="assist-suggestion-head">
                    <code>{suggestion.command}</code>
                    <span className={`assist-confidence ${suggestion.confidence}`}>{suggestion.confidence}</span>
                  </div>
                  <div className="assist-suggestion-reason">{suggestion.reason}</div>
                  <button
                    type="button"
                    className="ghost-btn assist-insert-btn"
                    onClick={() => onInsertAssistCommand(suggestion.command)}
                  >
                    写入终端
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {sideTab === "agent" ? (
        <section className="copilot-panel">
          <label className="field-label" htmlFor="agentQuickCommandInput">Quick Command</label>
          <div className="agent-inline-row">
            <input
              id="agentQuickCommandInput"
              value={agentQuickCommand}
              onChange={(event) => onInputChange(event, onAgentQuickCommandChange)}
              placeholder="e.g. cmd: ls -la | key:tab"
            />
            <button type="button" className="ghost-btn" onClick={onSendQuickCommand}>Send</button>
          </div>

          <label className="field-label" htmlFor="agentInstructionInput">Instruction</label>
          <textarea
            id="agentInstructionInput"
            rows={4}
            value={agentInstruction}
            onChange={(event) => onTextareaChange(event, onAgentInstructionChange)}
            placeholder="Describe what the agent should do."
          />

          <label className="field-label" htmlFor="agentSelectedPathsInput">Selected Files (one path per line)</label>
          <textarea
            id="agentSelectedPathsInput"
            rows={3}
            value={agentSelectedPaths}
            onChange={(event) => onTextareaChange(event, onAgentSelectedPathsChange)}
            placeholder="frontend/src/react/App.tsx"
          />

          <div className="agent-actions-row">
            <button type="button" className="primary-btn" onClick={onStartAgentRun} disabled={agentBusy}>Start Run</button>
            <button type="button" className="ghost-btn" onClick={onRefreshAgentRun} disabled={agentBusy}>Refresh</button>
          </div>

          <div className="agent-actions-row">
            <button type="button" className="ghost-btn" onClick={() => onApproveAgentRun(false)} disabled={agentBusy}>Approve Next</button>
            <button type="button" className="ghost-btn" onClick={() => onApproveAgentRun(true)} disabled={agentBusy}>Approve Risk</button>
            <button type="button" className="ghost-btn" onClick={onAbortAgentRun} disabled={agentBusy}>Abort</button>
          </div>

          {agentError && <div className="tree-status error">{agentError}</div>}

          {agentRun ? (
            <>
              <div className="agent-run-status">{agentRun.status} {agentRun.message ? `| ${agentRun.message}` : ""}</div>
              <div className="agent-steps-list">
                {agentRun.steps.length === 0 ? (
                  <div className="tree-status">No steps</div>
                ) : (
                  agentRun.steps.map((step) => (
                    <article key={`${agentRun.runId}-${step.stepIndex}`} className="agent-step-item">
                      <header className="agent-step-head">
                        <strong>#{step.stepIndex} {step.title || step.tool}</strong>
                        <span>{step.status}</span>
                      </header>
                      <div className="agent-step-body">
                        {step.error ? `error: ${step.error}` : (step.resultSummary || JSON.stringify(step.arguments))}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="agent-run-status">No run</div>
          )}
        </section>
      ) : null}
    </aside>
  );
}
