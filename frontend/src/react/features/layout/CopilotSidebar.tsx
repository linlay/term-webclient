import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { AssistSuggestionItem } from "../../shared/api/types";

interface CopilotSidebarProps {
  open: boolean;
  isMobile: boolean;
  sideTab: "summary" | "assist";
  sessionId: string | null;
  summaryLoading: boolean;
  summaryError: string;
  summaryContext: string;
  summaryScreenText: string;
  assistQuestion: string;
  assistSuggestions: AssistSuggestionItem[];
  assistCapturedScreenText: string;
  assistCapturedChars: number;
  assistBusy: boolean;
  assistError: string;
  onTabChange: (tab: "summary" | "assist") => void;
  onRefreshSummary: () => void;
  onCopySummaryContext: () => void;
  onCopySummaryScreen: () => void;
  onAssistQuestionChange: (value: string) => void;
  onGenerateAssistSuggestions: () => void;
  onInsertAssistCommand: (command: string) => void;
  onExecuteAssistCommand: (command: string) => void;
  onClose: () => void;
}

function onTextareaChange(event: ChangeEvent<HTMLTextAreaElement>, setter: (value: string) => void): void {
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
  assistQuestion,
  assistSuggestions,
  assistCapturedScreenText,
  assistCapturedChars,
  assistBusy,
  assistError,
  onTabChange,
  onRefreshSummary,
  onCopySummaryContext,
  onCopySummaryScreen,
  onAssistQuestionChange,
  onGenerateAssistSuggestions,
  onInsertAssistCommand,
  onExecuteAssistCommand,
  onClose
}: CopilotSidebarProps): JSX.Element {
  const [showRecentScreenText, setShowRecentScreenText] = useState(false);

  useEffect(() => {
    if (sideTab === "assist") {
      setShowRecentScreenText(false);
    }
  }, [sideTab, sessionId]);

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    onGenerateAssistSuggestions();
  }

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
          className={`ghost-btn copilot-tab ${sideTab === "assist" ? "active" : ""}`}
          onClick={() => onTabChange("assist")}
        >
          Assist
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

      {sideTab === "assist" ? (
        <section className="copilot-panel">
          <label className="field-label" htmlFor="assistQuestionInput">Question (Optional)</label>
          <textarea
            id="assistQuestionInput"
            rows={3}
            value={assistQuestion}
            onChange={(event) => onTextareaChange(event, onAssistQuestionChange)}
            onKeyDown={handleQuestionKeyDown}
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

          {showRecentScreenText && (
            <textarea
              data-testid="assist-screen-text"
              className="summary-text assist-screen-preview"
              rows={6}
              readOnly
              value={assistCapturedScreenText}
              placeholder="Recent screen text will appear here after generation."
            />
          )}

          <div className="assist-suggestion-list" data-testid="assist-suggestion-list">
            {assistSuggestions.length === 0 ? (
              <div className="agent-run-status">No suggestions yet</div>
            ) : (
              assistSuggestions.map((suggestion) => (
                <article key={suggestion.id} className="assist-suggestion-card">
                  <div className="assist-suggestion-main">
                    <code className="assist-suggestion-command">{suggestion.command}</code>
                    <div className="assist-suggestion-reason">{suggestion.reason}</div>
                  </div>
                  <div className="assist-suggestion-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => onInsertAssistCommand(suggestion.command)}
                    >
                      写入
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => onExecuteAssistCommand(suggestion.command)}
                    >
                      执行
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
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
