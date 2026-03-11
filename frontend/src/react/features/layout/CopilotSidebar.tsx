import type { CopilotAgentSummary } from "../../shared/api/types";
import { AssistPanel } from "./AssistPanel";
import type { AssistProps, RunnerProps, SummaryProps } from "./copilotPanelTypes";
import { RunnerPanel } from "./RunnerPanel";
import { SummaryPanel } from "./SummaryPanel";

export interface CopilotSidebarProps {
  open: boolean;
  isMobile: boolean;
  sideTab: "summary" | "agent";
  sessionId: string | null;
  agents: CopilotAgentSummary[];
  selectedAgentKey: string;
  selectedAgent: CopilotAgentSummary | null;
  summary: SummaryProps;
  assist: AssistProps;
  runner: RunnerProps;
  onTabChange: (tab: "summary" | "agent") => void;
  onSelectAgent: (agentKey: string) => void;
  onClose: () => void;
}

export function CopilotSidebar({
  open,
  isMobile,
  sideTab,
  sessionId,
  agents,
  selectedAgentKey,
  selectedAgent,
  summary,
  assist,
  runner,
  onTabChange,
  onSelectAgent,
  onClose
}: CopilotSidebarProps): JSX.Element {
  const showBuiltinAssist = selectedAgent?.type === "builtin_assist";

  return (
    <aside
      className={`agent-sidebar ${isMobile ? "mobile-sheet" : ""} ${open ? "" : "hidden"}`}
      aria-hidden={open ? "false" : "true"}
      data-testid="copilot-sidebar"
    >
      {isMobile && <div className="copilot-sheet-handle" aria-hidden="true" />}
      <div className="agent-header">
        <div className="agent-header-main">
          <div className="agent-title">Copilot</div>
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
        </div>
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

      {sideTab === "agent" ? (
        <section className="copilot-panel">
          <div className="copilot-agent-select-wrap">
            <div className="copilot-inline-field">
              <label className="field-label copilot-inline-label" htmlFor="copilotAgentSelect">Agent</label>
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
            </div>
            {!selectedAgent ? (
              <div className="agent-run-status">No agent available for the current session.</div>
            ) : null}
          </div>

          {showBuiltinAssist ? <AssistPanel {...assist} /> : null}
          <RunnerPanel {...runner} />
        </section>
      ) : null}

      {sideTab === "summary" ? <SummaryPanel {...summary} /> : null}

      <div data-session-id={sessionId || ""} hidden />
    </aside>
  );
}
