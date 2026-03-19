import type { ChangeEvent } from "react";

interface SshCredentialCreatorProps {
  sshAuthType: "password" | "privateKey";
  sshCreateTitle: string;
  sshCreateHost: string;
  sshCreatePort: string;
  sshCreateUsername: string;
  sshCreatePassword: string;
  sshCreatePrivateKey: string;
  sshCreatePrivateKeyPassphrase: string;
  createPending: boolean;
  onAuthTypeChange: (value: "password" | "privateKey") => void;
  onTitleChange: (value: string) => void;
  onHostChange: (value: string) => void;
  onPortChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPrivateKeyChange: (value: string) => void;
  onPassphraseChange: (value: string) => void;
  onCreate: () => void | Promise<void>;
}

export function SshCredentialCreator({
  sshAuthType,
  sshCreateTitle,
  sshCreateHost,
  sshCreatePort,
  sshCreateUsername,
  sshCreatePassword,
  sshCreatePrivateKey,
  sshCreatePrivateKeyPassphrase,
  createPending,
  onAuthTypeChange,
  onTitleChange,
  onHostChange,
  onPortChange,
  onUsernameChange,
  onPasswordChange,
  onPrivateKeyChange,
  onPassphraseChange,
  onCreate
}: SshCredentialCreatorProps): JSX.Element {
  return (
    <>
      <h3 className="modal-title">Create SSH Config</h3>

      <label className="field-label" htmlFor="new-ssh-title">Title (optional)</label>
      <input
        id="new-ssh-title"
        value={sshCreateTitle}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="prod api machine"
      />

      <label className="field-label" htmlFor="new-ssh-host">Host</label>
      <input
        id="new-ssh-host"
        value={sshCreateHost}
        onChange={(event) => onHostChange(event.target.value)}
        placeholder="10.0.0.2"
      />

      <label className="field-label" htmlFor="new-ssh-port">Port</label>
      <input
        id="new-ssh-port"
        value={sshCreatePort}
        onChange={(event) => onPortChange(event.target.value)}
        placeholder="22"
      />

      <label className="field-label" htmlFor="new-ssh-username">Username</label>
      <input
        id="new-ssh-username"
        value={sshCreateUsername}
        onChange={(event) => onUsernameChange(event.target.value)}
        placeholder="ubuntu"
      />

      <label className="field-label" htmlFor="new-ssh-auth-type">Auth Type</label>
      <select
        id="new-ssh-auth-type"
        value={sshAuthType}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onAuthTypeChange(event.target.value as "password" | "privateKey")}
      >
        <option value="password">password</option>
        <option value="privateKey">private key</option>
      </select>

      {sshAuthType === "password" ? (
        <>
          <label className="field-label" htmlFor="new-ssh-password">Password</label>
          <input
            id="new-ssh-password"
            type="password"
            value={sshCreatePassword}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </>
      ) : (
        <>
          <label className="field-label" htmlFor="new-ssh-private-key">Private Key</label>
          <textarea
            id="new-ssh-private-key"
            rows={5}
            value={sshCreatePrivateKey}
            onChange={(event) => onPrivateKeyChange(event.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />

          <label className="field-label" htmlFor="new-ssh-private-key-passphrase">Passphrase</label>
          <input
            id="new-ssh-private-key-passphrase"
            type="password"
            value={sshCreatePrivateKeyPassphrase}
            onChange={(event) => onPassphraseChange(event.target.value)}
            placeholder="optional"
          />
        </>
      )}

      <div className="agent-inline-row">
        <button type="button" className="ghost-btn" onClick={() => void onCreate()} disabled={createPending}>
          {createPending ? "Creating" : "Save SSH Config"}
        </button>
      </div>
    </>
  );
}
