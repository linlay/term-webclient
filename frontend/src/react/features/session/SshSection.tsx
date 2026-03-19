import type { ChangeEvent } from "react";
import type { SshCredentialSummaryResponse } from "../../shared/api/types";

interface SshSectionProps {
  sshCredentials: SshCredentialSummaryResponse[];
  sshCredentialsLoading: boolean;
  sshCredentialId: string;
  sshTerm: string;
  selectedCredential: SshCredentialSummaryResponse | null;
  preflightPending: boolean;
  deletePending: boolean;
  onCredentialChange: (value: string) => void;
  onTermChange: (value: string) => void;
  onRefresh: () => void | Promise<void>;
  onPreflight: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}

function formatCredential(credential: SshCredentialSummaryResponse): string {
  return `${credential.username}@${credential.host}:${credential.port} (${credential.authType})`;
}

function formatSshCredentialOptionLabel(credential: SshCredentialSummaryResponse): string {
  if (credential.title && credential.title.trim()) {
    return credential.title.trim();
  }
  return formatCredential(credential);
}

export function SshSection({
  sshCredentials,
  sshCredentialsLoading,
  sshCredentialId,
  sshTerm,
  selectedCredential,
  preflightPending,
  deletePending,
  onCredentialChange,
  onTermChange,
  onRefresh,
  onPreflight,
  onDelete
}: SshSectionProps): JSX.Element {
  return (
    <>
      <label className="field-label" htmlFor="new-session-ssh-credential">Saved SSH Configs</label>
      <select
        id="new-session-ssh-credential"
        value={sshCredentialId}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onCredentialChange(event.target.value)}
        disabled={sshCredentialsLoading}
      >
        {sshCredentials.length === 0 && <option value="">No credentials</option>}
        {sshCredentials.map((credential) => (
          <option key={credential.credentialId} value={credential.credentialId}>
            {formatSshCredentialOptionLabel(credential)}
          </option>
        ))}
      </select>

      <label className="field-label" htmlFor="new-session-ssh-term">TERM</label>
      <input
        id="new-session-ssh-term"
        value={sshTerm}
        onChange={(event) => onTermChange(event.target.value)}
        placeholder="xterm-256color"
      />

      <div className="agent-inline-row">
        <button type="button" className="ghost-btn" onClick={() => void onRefresh()} disabled={sshCredentialsLoading}>
          {sshCredentialsLoading ? "Loading" : "Refresh"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => void onPreflight()}
          disabled={!selectedCredential || preflightPending}
        >
          {preflightPending ? "Checking" : "Preflight"}
        </button>
        <button
          type="button"
          className="ghost-btn ssh-delete-btn"
          onClick={() => void onDelete()}
          disabled={!selectedCredential || deletePending}
        >
          Delete
        </button>
      </div>
    </>
  );
}
