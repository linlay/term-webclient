import type { SummaryProps } from "./copilotPanelTypes";

export function SummaryPanel({
  loading,
  error,
  context,
  screenText,
  onRefresh,
  onCopyContext,
  onCopyScreen
}: SummaryProps): JSX.Element {
  return (
    <section className="copilot-panel">
      <div className="summary-actions">
        <button type="button" className="ghost-btn" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        <button type="button" className="ghost-btn" onClick={onCopyContext}>Copy Context JSON</button>
        <button type="button" className="ghost-btn" onClick={onCopyScreen}>Copy Screen Text</button>
      </div>

      {error && <div className="tree-status error">{error}</div>}

      <label className="field-label" htmlFor="sessionSummaryContextText">Structured Context</label>
      <textarea id="sessionSummaryContextText" className="summary-text" rows={8} readOnly value={context} />

      <label className="field-label" htmlFor="sessionSummaryScreenText">Screen Text</label>
      <textarea id="sessionSummaryScreenText" className="summary-text" rows={8} readOnly value={screenText} />
    </section>
  );
}
