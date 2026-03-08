import type { ChangeEvent } from "react";
import type { AgentRunResponse } from "../../shared/api/types";

interface CopilotSidebarProps {
  open: boolean;
  sideTab: "summary" | "agent";
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
  onTabChange: (tab: "summary" | "agent") => void;
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
  onClose
}: CopilotSidebarProps): JSX.Element {
  return (
    <aside className={`agent-sidebar ${open ? "" : "hidden"}`} aria-hidden={open ? "false" : "true"}>
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
      ) : (
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
      )}
    </aside>
  );
}
