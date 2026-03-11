import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { AssistProps } from "./copilotPanelTypes";

function onTextareaChange(event: ChangeEvent<HTMLTextAreaElement>, setter: (value: string) => void): void {
  setter(event.target.value);
}

export function AssistPanel({
  sessionId,
  selectedAgentKey,
  question,
  suggestions,
  capturedScreenText,
  capturedChars,
  busy,
  error,
  hasLastSubmittedQuestion,
  onQuestionChange,
  onGenerateSuggestions,
  onClearQuestion,
  onRestoreLastQuestion,
  onCopyCommand,
  onInsertCommand,
  onExecuteCommand
}: AssistProps): JSX.Element {
  const [showRecentScreenText, setShowRecentScreenText] = useState(false);
  const recentScreenTextRef = useRef<HTMLDivElement | null>(null);
  const visibleAssistSuggestions = suggestions.slice(0, 3);

  useEffect(() => {
    setShowRecentScreenText(false);
  }, [sessionId, selectedAgentKey]);

  useEffect(() => {
    if (!showRecentScreenText) {
      return;
    }
    function handlePointerDown(event: MouseEvent): void {
      if (recentScreenTextRef.current?.contains(event.target as Node)) {
        return;
      }
      setShowRecentScreenText(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [showRecentScreenText]);

  function handleAssistQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const isComposing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (isComposing) {
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    onGenerateSuggestions();
  }

  return (
    <>
      <div className="copilot-inline-field copilot-question-header">
        <label className="field-label" htmlFor="assistQuestionInput">Question (Optional)</label>
        <div className="assist-screen-anchor" ref={recentScreenTextRef}>
          <button
            type="button"
            className="ghost-btn assist-inline-btn"
            data-testid="assist-screen-toggle"
            aria-expanded={showRecentScreenText ? "true" : "false"}
            onClick={() => setShowRecentScreenText((prev) => !prev)}
          >
            Recent screen text
          </button>
          {showRecentScreenText ? (
            <div className="assist-screen-popover" data-testid="assist-screen-popover">
              <textarea
                data-testid="assist-screen-text"
                className="summary-text assist-screen-preview"
                rows={6}
                readOnly
                value={capturedScreenText}
                placeholder="Recent screen text will appear here after generation."
              />
              <div className="assist-screen-meta">
                {capturedChars > 0 ? `${capturedChars} chars` : "No captured text"}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <textarea
        id="assistQuestionInput"
        rows={2}
        value={question}
        onChange={(event) => onTextareaChange(event, onQuestionChange)}
        onKeyDown={handleAssistQuestionKeyDown}
        placeholder="Describe what you want to inspect, or leave empty and let AI infer from recent screen text."
      />

      <div className="agent-actions-row assist-generate-actions">
        <button
          type="button"
          className="primary-btn"
          onClick={onGenerateSuggestions}
          disabled={busy}
        >
          {busy ? "Generating..." : "生成建议"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={onRestoreLastQuestion}
          disabled={!hasLastSubmittedQuestion}
        >
          上一条
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={onClearQuestion}
          disabled={!question.trim()}
        >
          清空
        </button>
      </div>

      {error && <div className="tree-status error">{error}</div>}

      <div className="assist-suggestion-list" data-testid="assist-suggestion-list">
        {visibleAssistSuggestions.length === 0 ? (
          <div className="agent-run-status">No suggestions yet</div>
        ) : (
          visibleAssistSuggestions.map((suggestion) => (
            <article key={suggestion.id} className="assist-suggestion-card">
              <div className="assist-suggestion-main">
                <div className="assist-suggestion-meta">
                  <span className="assist-suggestion-weight">Weight {suggestion.weight}</span>
                  <div className="assist-suggestion-actions">
                    <button
                      type="button"
                      className="ghost-btn assist-icon-btn"
                      aria-label="复制"
                      title="复制"
                      data-testid="assist-copy-btn"
                      onClick={() => onCopyCommand(suggestion.command)}
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
                      onClick={() => onInsertCommand(suggestion.command)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 19V5" />
                        <path d="m5 12 7 7 7-7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="ghost-btn assist-text-btn"
                      data-testid="assist-execute-btn"
                      onClick={() => onExecuteCommand(suggestion.command)}
                    >
                      执行
                    </button>
                  </div>
                </div>
                <code className="assist-suggestion-command" title={suggestion.command}>{suggestion.command}</code>
                <div className="assist-suggestion-reason" title={suggestion.reason}>{suggestion.reason}</div>
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}
