interface CloseTabConfirmModalProps {
  open: boolean;
  tabTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CloseTabConfirmModal({ open, tabTitle, onConfirm, onCancel }: CloseTabConfirmModalProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="modal" role="alertdialog" aria-modal="true" data-testid="close-tab-confirm-modal">
      <div className="modal-backdrop" onClick={onCancel} />
      <div className="modal-panel close-tab-confirm-panel">
        <div className="modal-header">
          <h2 className="modal-title">确认关闭</h2>
        </div>
        <div className="modal-body">
          <p className="close-tab-confirm-text">
            确认关闭会话 <strong>{tabTitle}</strong>？
          </p>
          <div className="modal-actions">
            <button type="button" className="ghost-btn" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="primary-btn" onClick={onConfirm}>
              确认关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
