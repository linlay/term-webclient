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
  onClearAssistQuestion: () => void;
  onCopyAssistCommand: (command: string) => void;
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
  onClearAssistQuestion,
  onCopyAssistCommand,
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
            rows={2}
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
