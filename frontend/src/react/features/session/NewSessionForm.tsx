import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { generateId } from "../../shared/utils/id";
import type {
  CreateSessionRequest,
  CreateSshCredentialRequest,
  SessionType,
  SshCredentialSummaryResponse,
  TerminalClientResponse,
  WorkdirBrowseResponse
} from "../../shared/api/types";

export interface NewSessionCreatedPayload {
  sessionId: string;
  wsUrl: string;
  title: string;
  clientId: string;
  sessionType: SessionType;
  toolId: string;
  workdir: string;
  sshCredentialId: string | null;
  createRequest: CreateSessionRequest;
}

interface NewSessionFormProps {
  onCreated: (payload: NewSessionCreatedPayload) => void;
  variant?: "modal" | "inline";
  onCancel?: () => void;
}

function parseArgsInput(value: string): string[] {
  const source = (value || "").trim();
  if (!source) {
    return [];
  }

  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escapeNext = false;

  for (const char of source) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escapeNext || quote) {
    throw new Error("Args has invalid escaping or unclosed quotes.");
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function formatCredential(credential: SshCredentialSummaryResponse): string {
  return `${credential.username}@${credential.host}:${credential.port} (${credential.authType})`;
}

export function NewSessionForm({ onCreated, variant = "modal", onCancel }: NewSessionFormProps): JSX.Element {
  const [toolId, setToolId] = useState("terminal");
  const [terminalClients, setTerminalClients] = useState<TerminalClientResponse[]>([]);
  const [terminalClientsLoading, setTerminalClientsLoading] = useState(false);
  const [terminalClientsError, setTerminalClientsError] = useState("");

  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("/bin/zsh");
  const [args, setArgs] = useState("-l");
  const [workdir, setWorkdir] = useState(".");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [workdirTree, setWorkdirTree] = useState<WorkdirBrowseResponse | null>(null);
  const [workdirLoading, setWorkdirLoading] = useState(false);
  const [workdirError, setWorkdirError] = useState("");

  const [sshCredentials, setSshCredentials] = useState<SshCredentialSummaryResponse[]>([]);
  const [sshCredentialsLoading, setSshCredentialsLoading] = useState(false);
  const [sshCredentialId, setSshCredentialId] = useState("");
  const [sshTerm, setSshTerm] = useState("xterm-256color");
  const [sshAuthType, setSshAuthType] = useState<"password" | "privateKey">("password");
  const [sshCreateHost, setSshCreateHost] = useState("");
  const [sshCreatePort, setSshCreatePort] = useState("22");
  const [sshCreateUsername, setSshCreateUsername] = useState("");
  const [sshCreatePassword, setSshCreatePassword] = useState("");
  const [sshCreatePrivateKey, setSshCreatePrivateKey] = useState("");
  const [sshCreatePrivateKeyPassphrase, setSshCreatePrivateKeyPassphrase] = useState("");
  const [sshCreateError, setSshCreateError] = useState("");

  const createSessionMutation = useMutation({
    mutationFn: (payload: CreateSessionRequest) => apiClient.createSession(payload)
  });

  const createSshCredentialMutation = useMutation({
    mutationFn: (payload: CreateSshCredentialRequest) => apiClient.createSshCredential(payload)
  });

  const preflightMutation = useMutation({
    mutationFn: (credentialId: string) => apiClient.preflightSshCredential(credentialId)
  });

  const deleteSshCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => apiClient.deleteSshCredential(credentialId)
  });

  const sessionType: SessionType = toolId === "ssh" ? "SSH_SHELL" : "LOCAL_PTY";

  const selectedClient = useMemo(
    () => terminalClients.find((item) => item.id === toolId) ?? null,
    [terminalClients, toolId]
  );

  const selectedCredential = useMemo(
    () => sshCredentials.find((credential) => credential.credentialId === sshCredentialId) ?? null,
    [sshCredentialId, sshCredentials]
  );

  const toolOptions = useMemo(() => {
    const clientOptions = terminalClients.map((client) => ({
      value: client.id,
      label: client.label || client.id
    }));
    return [
      { value: "terminal", label: "terminal" },
      ...clientOptions,
      { value: "ssh", label: "ssh" }
    ];
  }, [terminalClients]);

  useEffect(() => {
    if (toolId === "terminal") {
      setCommand("/bin/zsh");
      setArgs("-l");
      return;
    }
    if (selectedClient && !workdir.trim()) {
      setWorkdir(selectedClient.defaultWorkdir || ".");
    }
  }, [selectedClient, toolId, workdir]);

  useEffect(() => {
    void refreshCredentials();
    void browseWorkdir();
    void refreshTerminalClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshTerminalClients(): Promise<void> {
    setTerminalClientsLoading(true);
    setTerminalClientsError("");
    try {
      const next = await apiClient.listTerminalClients();
      setTerminalClients(next);
      const validIds = new Set(["terminal", "ssh", ...next.map((item) => item.id)]);
      if (!validIds.has(toolId)) {
        setToolId("terminal");
      }
    } catch (e) {
      setTerminalClientsError(e instanceof Error ? e.message : "Failed to load terminal clients");
    } finally {
      setTerminalClientsLoading(false);
    }
  }

  async function refreshCredentials(): Promise<void> {
    setSshCredentialsLoading(true);
    setSshCreateError("");
    try {
      const next = await apiClient.listSshCredentials();
      setSshCredentials(next);
      if (!sshCredentialId && next.length > 0) {
        setSshCredentialId(next[0].credentialId);
      } else if (sshCredentialId && !next.some((item) => item.credentialId === sshCredentialId)) {
        setSshCredentialId(next[0]?.credentialId ?? "");
      }
    } catch (e) {
      setSshCreateError(e instanceof Error ? e.message : "Failed to load SSH credentials");
    } finally {
      setSshCredentialsLoading(false);
    }
  }

  async function browseWorkdir(path?: string): Promise<void> {
    setWorkdirLoading(true);
    setWorkdirError("");
    try {
      const next = await apiClient.getWorkdirTree(path);
      setWorkdirTree(next);
      if (!workdir.trim()) {
        setWorkdir(next.currentPath || ".");
      }
    } catch (e) {
      setWorkdirError(e instanceof Error ? e.message : "Failed to browse workdir");
    } finally {
      setWorkdirLoading(false);
    }
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const wsClientId = generateId();
    const titleText = title.trim();

    let payload: CreateSessionRequest;

    if (sessionType === "SSH_SHELL") {
      if (!sshCredentialId) {
        setError("Please select an SSH credential.");
        return;
      }
      payload = {
        sessionType: "SSH_SHELL",
        tabTitle: titleText || "ssh",
        toolId: "ssh",
        ssh: {
          credentialId: sshCredentialId,
          term: sshTerm.trim() || "xterm-256color"
        }
      };
    } else if (selectedClient) {
      const resolvedWorkdir = workdir.trim() || selectedClient.defaultWorkdir || ".";
      payload = {
        sessionType: "LOCAL_PTY",
        clientId: selectedClient.id,
        toolId: selectedClient.id,
        tabTitle: titleText || (selectedClient.label || selectedClient.id),
        workdir: resolvedWorkdir
      };
    } else {
      let parsedArgs: string[];
      try {
        parsedArgs = parseArgsInput(args);
      } catch (parseError) {
        setError(parseError instanceof Error ? parseError.message : "Invalid args");
        return;
      }
      payload = {
        sessionType: "LOCAL_PTY",
        toolId: "terminal",
        tabTitle: titleText || "terminal",
        command: command.trim() || "/bin/zsh",
        args: parsedArgs,
        workdir: workdir.trim() || "."
      };
    }

    try {
      const response = await createSessionMutation.mutateAsync(payload);
      onCreated({
        sessionId: response.sessionId,
        wsUrl: response.wsUrl,
        title: payload.tabTitle || (sessionType === "SSH_SHELL" ? "ssh" : "terminal"),
        clientId: wsClientId,
        sessionType,
        toolId: payload.toolId || (sessionType === "SSH_SHELL" ? "ssh" : "terminal"),
        workdir: payload.workdir || ".",
        sshCredentialId: payload.ssh?.credentialId || null,
        createRequest: payload
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    }
  };

  async function onCreateSshCredential() {
    setSshCreateError("");
    setNotice("");

    const host = sshCreateHost.trim();
    const username = sshCreateUsername.trim();
    const port = Number.parseInt(sshCreatePort, 10);

    if (!host || !username || !Number.isFinite(port) || port <= 0 || port > 65535) {
      setSshCreateError("Host/username/port is invalid.");
      return;
    }

    const payload: CreateSshCredentialRequest = {
      host,
      username,
      port
    };

    if (sshAuthType === "password") {
      if (!sshCreatePassword) {
        setSshCreateError("Password is required for password auth.");
        return;
      }
      payload.password = sshCreatePassword;
    } else {
      if (!sshCreatePrivateKey.trim()) {
        setSshCreateError("Private key is required for private key auth.");
        return;
      }
      payload.privateKey = sshCreatePrivateKey;
      payload.privateKeyPassphrase = sshCreatePrivateKeyPassphrase || undefined;
    }

    try {
      const created = await createSshCredentialMutation.mutateAsync(payload);
      await refreshCredentials();
      setSshCredentialId(created.credentialId);
      setSshCreatePassword("");
      setSshCreatePrivateKey("");
      setSshCreatePrivateKeyPassphrase("");
      setNotice("SSH credential created.");
    } catch (e) {
      setSshCreateError(e instanceof Error ? e.message : "Failed to create SSH credential");
    }
  }

  async function onDeleteSelectedCredential() {
    if (!selectedCredential) {
      return;
    }
    if (!window.confirm(`Delete SSH credential ${formatCredential(selectedCredential)} ?`)) {
      return;
    }
    setSshCreateError("");
    setNotice("");
    try {
      await deleteSshCredentialMutation.mutateAsync(selectedCredential.credentialId);
      await refreshCredentials();
      setNotice("SSH credential deleted.");
    } catch (e) {
      setSshCreateError(e instanceof Error ? e.message : "Failed to delete SSH credential");
    }
  }

  async function onPreflightSelectedCredential() {
    if (!selectedCredential) {
      return;
    }
    setSshCreateError("");
    setNotice("");
    try {
      const result = await preflightMutation.mutateAsync(selectedCredential.credentialId);
      setNotice(result.success
        ? `Preflight ok (${result.durationMs} ms)`
        : `Preflight failed: ${result.message}`);
    } catch (e) {
      setSshCreateError(e instanceof Error ? e.message : "SSH preflight failed");
    }
  }

  return (
    <form className={`new-session-form ${variant === "modal" ? "modal-body" : ""}`} onSubmit={onSubmit}>
      <label className="field-label" htmlFor="new-session-tool">Tool</label>
      <div className="agent-inline-row">
        <select
          id="new-session-tool"
          value={toolId}
          onChange={(event) => setToolId(event.target.value)}
        >
          {toolOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button type="button" className="ghost-btn" onClick={() => void refreshTerminalClients()} disabled={terminalClientsLoading}>
          {terminalClientsLoading ? "Loading" : "Refresh"}
        </button>
      </div>
      {terminalClientsError && <div className="tree-status error">{terminalClientsError}</div>}

      <label className="field-label" htmlFor="new-session-title">Title (optional)</label>
      <input
        id="new-session-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={toolId === "ssh" ? "ssh" : toolId}
      />

      {sessionType === "LOCAL_PTY" && (
        <>
          <section className="advanced-section">
            <label className="field-label" htmlFor="new-session-workdir">Workdir</label>
            <input
              id="new-session-workdir"
              value={workdir}
              onChange={(event) => setWorkdir(event.target.value)}
              placeholder="."
            />

            <div className="agent-inline-row">
              <button type="button" className="ghost-btn" onClick={() => void browseWorkdir(workdirTree?.currentPath)}>
                Refresh Workdir
              </button>
              {workdirTree && (
                <button type="button" className="ghost-btn" onClick={() => void browseWorkdir(workdirTree.rootPath)}>
                  Go Root
                </button>
              )}
            </div>

            <div className="workdir-tree" role="tree">
              {workdirLoading && <div className="tree-status">Loading workdir...</div>}
              {!workdirLoading && workdirError && <div className="tree-status error">{workdirError}</div>}
              {!workdirLoading && !workdirError && workdirTree && (
                <div className="tree-list">
                  {workdirTree.entries.length === 0 ? (
                    <div className="tree-status">No entries</div>
                  ) : (
                    workdirTree.entries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className={`tree-label ${workdir === entry.path ? "selected" : ""}`}
                        title={entry.path}
                        onClick={() => {
                          setWorkdir(entry.path);
                          if (entry.hasChildren) {
                            void browseWorkdir(entry.path);
                          }
                        }}
                      >
                        {entry.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="selected-workdir">Selected: <code>{workdir || "-"}</code></div>
          </section>

          {toolId === "terminal" && (
            <section className="advanced-section">
              <label className="field-label" htmlFor="new-session-command">Command</label>
              <input
                id="new-session-command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="/bin/zsh"
              />

              <label className="field-label" htmlFor="new-session-args">Args</label>
              <input
                id="new-session-args"
                value={args}
                onChange={(event) => setArgs(event.target.value)}
                placeholder="-l"
              />
            </section>
          )}
        </>
      )}

      {sessionType === "SSH_SHELL" && (
        <section className="advanced-section">
          <label className="field-label" htmlFor="new-session-ssh-credential">Saved SSH Configs</label>
          <select
            id="new-session-ssh-credential"
            value={sshCredentialId}
            onChange={(event) => setSshCredentialId(event.target.value)}
            disabled={sshCredentialsLoading}
          >
            {sshCredentials.length === 0 && <option value="">No credentials</option>}
            {sshCredentials.map((credential) => (
              <option key={credential.credentialId} value={credential.credentialId}>
                {formatCredential(credential)}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="new-session-ssh-term">TERM</label>
          <input
            id="new-session-ssh-term"
            value={sshTerm}
            onChange={(event) => setSshTerm(event.target.value)}
            placeholder="xterm-256color"
          />

          <div className="agent-inline-row">
            <button type="button" className="ghost-btn" onClick={() => void refreshCredentials()} disabled={sshCredentialsLoading}>
              {sshCredentialsLoading ? "Loading" : "Refresh"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void onPreflightSelectedCredential()}
              disabled={!selectedCredential || preflightMutation.isPending}
            >
              {preflightMutation.isPending ? "Checking" : "Preflight"}
            </button>
            <button
              type="button"
              className="ghost-btn ssh-delete-btn"
              onClick={() => void onDeleteSelectedCredential()}
              disabled={!selectedCredential || deleteSshCredentialMutation.isPending}
            >
              Delete
            </button>
          </div>

          <h3 className="modal-title">Create SSH Config</h3>

          <label className="field-label" htmlFor="new-ssh-host">Host</label>
          <input
            id="new-ssh-host"
            value={sshCreateHost}
            onChange={(event) => setSshCreateHost(event.target.value)}
            placeholder="10.0.0.2"
          />

          <label className="field-label" htmlFor="new-ssh-port">Port</label>
          <input
            id="new-ssh-port"
            value={sshCreatePort}
            onChange={(event) => setSshCreatePort(event.target.value)}
            placeholder="22"
          />

          <label className="field-label" htmlFor="new-ssh-username">Username</label>
          <input
            id="new-ssh-username"
            value={sshCreateUsername}
            onChange={(event) => setSshCreateUsername(event.target.value)}
            placeholder="ubuntu"
          />

          <label className="field-label" htmlFor="new-ssh-auth-type">Auth Type</label>
          <select
            id="new-ssh-auth-type"
            value={sshAuthType}
            onChange={(event) => setSshAuthType(event.target.value as "password" | "privateKey")}
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
                onChange={(event) => setSshCreatePassword(event.target.value)}
              />
            </>
          ) : (
            <>
              <label className="field-label" htmlFor="new-ssh-private-key">Private Key</label>
              <textarea
                id="new-ssh-private-key"
                rows={5}
                value={sshCreatePrivateKey}
                onChange={(event) => setSshCreatePrivateKey(event.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />

              <label className="field-label" htmlFor="new-ssh-private-key-passphrase">Passphrase</label>
              <input
                id="new-ssh-private-key-passphrase"
                type="password"
                value={sshCreatePrivateKeyPassphrase}
                onChange={(event) => setSshCreatePrivateKeyPassphrase(event.target.value)}
                placeholder="optional"
              />
            </>
          )}

          <div className="agent-inline-row">
            <button type="button" className="ghost-btn" onClick={() => void onCreateSshCredential()} disabled={createSshCredentialMutation.isPending}>
              {createSshCredentialMutation.isPending ? "Creating" : "Save SSH Config"}
            </button>
          </div>
        </section>
      )}

      {notice && <div className="tree-status">{notice}</div>}
      {(error || sshCreateError) && <div className="tree-status error">{error || sshCreateError}</div>}

      <div className="modal-actions">
        {onCancel && (
          <button type="button" className="ghost-btn" onClick={onCancel}>Cancel</button>
        )}
        <button type="submit" className="primary-btn" disabled={createSessionMutation.isPending}>
          {createSessionMutation.isPending ? "Creating..." : "Create Window"}
        </button>
      </div>
    </form>
  );
}
