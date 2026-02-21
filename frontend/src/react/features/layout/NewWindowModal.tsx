import { NewSessionForm, type NewSessionCreatedPayload } from "../session/NewSessionForm";

interface NewWindowModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (payload: NewSessionCreatedPayload) => void;
}

export function NewWindowModal({ open, onClose, onCreated }: NewWindowModalProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="modal" aria-hidden="false" data-testid="new-window-modal">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="newWindowTitle">
        <div className="modal-header">
          <h2 id="newWindowTitle" className="modal-title">New Window</h2>
        </div>
        <NewSessionForm
          variant="modal"
          onCancel={onClose}
          onCreated={(payload) => {
            onCreated(payload);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
