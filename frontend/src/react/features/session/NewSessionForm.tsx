import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type WheelEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import { generateId } from "../../shared/utils/id";
import type {
  CreateSessionRequest,
  CreateSshCredentialRequest,
  RecentSessionItemResponse,
  SessionType,
  SshCredentialSummaryResponse,
  TerminalClientResponse,
  WorkdirEntry,
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
  fileRootPath: string;
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

function formatSshCredentialOptionLabel(credential: SshCredentialSummaryResponse): string {
  if (credential.title && credential.title.trim()) {
    return credential.title.trim();
  }
  return formatCredential(credential);
}

function cloneCreateSessionRequest(payload: CreateSessionRequest): CreateSessionRequest {
  return {
    ...payload,
    args: payload.args ? [...payload.args] : undefined,
    env: payload.env ? { ...payload.env } : undefined,
    ssh: payload.ssh ? { ...payload.ssh } : undefined
  };
}

function formatRecentSessionLabel(item: RecentSessionItemResponse): string {
  const title = (item.title || "").trim();
  if (title) {
    return title;
  }
  const workdir = (item.workdir || "").trim();
  if (workdir) {
    return workdir;
  }
  return (item.toolId || "session").trim() || "session";
}

const ROOT_WORKDIR_LOADING_KEY = "__root__";

interface VisibleWorkdirEntry {
  depth: number;
  entry: WorkdirEntry;
}

export function NewSessionForm({ onCreated, variant = "modal", onCancel }: NewSessionFormProps): JSX.Element {
  const [toolId, setToolId] = useState("terminal");
  const [terminalClients, setTerminalClients] = useState<TerminalClientResponse[]>([]);
  const [terminalClientsError, setTerminalClientsError] = useState("");

  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("/bin/zsh");
  const [args, setArgs] = useState("-l");
  const [workdir, setWorkdir] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recentSessions, setRecentSessions] = useState<RecentSessionItemResponse[]>([]);
  const [recentSessionsLoading, setRecentSessionsLoading] = useState(false);
  const [recentSessionsError, setRecentSessionsError] = useState("");
  const [selectedRecentSessionIndex, setSelectedRecentSessionIndex] = useState("");

  const [workdirTree, setWorkdirTree] = useState<WorkdirBrowseResponse | null>(null);
  const [workdirChildrenMap, setWorkdirChildrenMap] = useState<Record<string, WorkdirEntry[]>>({});
  const [workdirExpandedMap, setWorkdirExpandedMap] = useState<Record<string, boolean>>({});
  const [workdirLoadingMap, setWorkdirLoadingMap] = useState<Record<string, boolean>>({});
  const [workdirError, setWorkdirError] = useState("");

  const [sshCredentials, setSshCredentials] = useState<SshCredentialSummaryResponse[]>([]);
  const [sshCredentialsLoading, setSshCredentialsLoading] = useState(false);
  const [sshCredentialId, setSshCredentialId] = useState("");
  const [sshTerm, setSshTerm] = useState("xterm-256color");
  const [sshAuthType, setSshAuthType] = useState<"password" | "privateKey">("password");
  const [sshCreateTitle, setSshCreateTitle] = useState("");
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

  const workdirLoading = useMemo(
    () => Object.keys(workdirLoadingMap).length > 0,
    [workdirLoadingMap]
  );

  const visibleWorkdirEntries = useMemo<VisibleWorkdirEntry[]>(() => {
    if (!workdirTree) {
      return [];
    }

    const flattened: VisibleWorkdirEntry[] = [];
    const visited = new Set<string>();

    const walk = (parentPath: string, depth: number) => {
      if (visited.has(parentPath)) {
        return;
      }
      visited.add(parentPath);
      const children = workdirChildrenMap[parentPath] || [];
      for (const entry of children) {
        flattened.push({ depth, entry });
        if (workdirExpandedMap[entry.path]) {
          walk(entry.path, depth + 1);
        }
      }
    };

    walk(workdirTree.rootPath, 0);
    return flattened;
  }, [workdirChildrenMap, workdirExpandedMap, workdirTree]);

  useEffect(() => {
    if (toolId === "terminal") {
      if (!command.trim()) {
        setCommand("/bin/zsh");
      }
      if (!args.trim()) {
        setArgs("-l");
      }
      return;
    }
    if (selectedClient && !workdir.trim()) {
      setWorkdir(selectedClient.defaultWorkdir || workdirTree?.currentPath || ".");
    }
  }, [args, command, selectedClient, toolId, workdir, workdirTree]);

  useEffect(() => {
    void refreshCredentials();
    void browseWorkdir();
    void refreshTerminalClients();
    void refreshRecentSessions(toolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSelectedRecentSessionIndex("");
    void refreshRecentSessions(toolId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId]);

  async function refreshTerminalClients(): Promise<void> {
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
    }
  }

  async function refreshRecentSessions(nextToolId: string): Promise<void> {
    const normalizedToolId = (nextToolId || "").trim();
    if (!normalizedToolId) {
      setRecentSessions([]);
      return;
    }
    setRecentSessionsLoading(true);
    setRecentSessionsError("");
    try {
      const recent = await apiClient.listRecentSessions(normalizedToolId);
      setRecentSessions(recent);
    } catch (e) {
      setRecentSessions([]);
      setRecentSessionsError(e instanceof Error ? e.message : "Failed to load recent sessions");
    } finally {
      setRecentSessionsLoading(false);
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

  function setWorkdirPathLoading(pathKey: string, loading: boolean): void {
    setWorkdirLoadingMap((prev) => {
      if (loading) {
        return { ...prev, [pathKey]: true };
      }
      if (!prev[pathKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[pathKey];
      return next;
    });
  }

  async function browseWorkdir(path?: string): Promise<void> {
    const normalizedPath = path?.trim();
    const requestPath = normalizedPath && normalizedPath.length > 0 ? normalizedPath : undefined;
    const loadingKey = requestPath || ROOT_WORKDIR_LOADING_KEY;
    setWorkdirPathLoading(loadingKey, true);
    setWorkdirError("");
    try {
      const next = await apiClient.getWorkdirTree(requestPath);
      setWorkdirTree(next);
      setWorkdirChildrenMap((prev) => ({
        ...prev,
        [next.currentPath]: next.entries
      }));
      setWorkdirExpandedMap((prev) => ({
        ...prev,
        [next.rootPath]: true,
        [next.currentPath]: true
      }));
      if (!workdir.trim()) {
        setWorkdir(next.currentPath || ".");
      }
    } catch (e) {
      setWorkdirError(e instanceof Error ? e.message : "Failed to browse workdir");
    } finally {
      setWorkdirPathLoading(loadingKey, false);
    }
  }

  async function onSelectRootWorkdir(): Promise<void> {
    if (!workdirTree) {
      await browseWorkdir();
      return;
    }
    setWorkdir(workdirTree.rootPath);
    setWorkdirExpandedMap((prev) => ({
      ...prev,
      [workdirTree.rootPath]: true
    }));
    if (!workdirChildrenMap[workdirTree.rootPath]) {
      await browseWorkdir(workdirTree.rootPath);
    }
  }

  async function onSelectWorkdirEntry(entry: WorkdirEntry): Promise<void> {
    setWorkdir(entry.path);
    if (!entry.hasChildren) {
      return;
    }
    const expanded = Boolean(workdirExpandedMap[entry.path]);
    if (expanded) {
      setWorkdirExpandedMap((prev) => ({
        ...prev,
        [entry.path]: false
      }));
      return;
    }
    setWorkdirExpandedMap((prev) => ({
      ...prev,
      [entry.path]: true
    }));
    if (!workdirChildrenMap[entry.path]) {
      await browseWorkdir(entry.path);
    }
  }

  function onWorkdirTreeWheel(event: WheelEvent<HTMLDivElement>): void {
    const container = event.currentTarget;
    if (container.scrollHeight <= container.clientHeight) {
      return;
    }
    container.scrollTop += event.deltaY;
    event.preventDefault();
  }

  async function createSessionWithPayload(payload: CreateSessionRequest): Promise<void> {
    const normalizedPayload = cloneCreateSessionRequest(payload);
    const sessionTypeValue: SessionType = normalizedPayload.sessionType === "SSH_SHELL" ? "SSH_SHELL" : "LOCAL_PTY";
    const wsClientId = generateId();
    const response = await createSessionMutation.mutateAsync(normalizedPayload);
    const fallbackToolId = sessionTypeValue === "SSH_SHELL" ? "ssh" : "terminal";
    const resolvedToolId = (normalizedPayload.toolId || fallbackToolId).trim() || fallbackToolId;
    const fallbackTitle = sessionTypeValue === "SSH_SHELL"
      ? "ssh"
      : ((normalizedPayload.workdir || "").trim() || ".");
    const resolvedTitle = (normalizedPayload.tabTitle || "").trim() || fallbackTitle;

    onCreated({
      sessionId: response.sessionId,
      wsUrl: response.wsUrl,
      title: resolvedTitle,
      clientId: wsClientId,
      sessionType: sessionTypeValue,
      toolId: resolvedToolId,
      workdir: normalizedPayload.workdir || ".",
      fileRootPath: normalizedPayload.workdir || ".",
      sshCredentialId: normalizedPayload.ssh?.credentialId || null,
      createRequest: normalizedPayload
    });
  }

  function applyRecentToForm(item: RecentSessionItemResponse): void {
    setError("");
    setNotice("");
    const sourceRequest: CreateSessionRequest = item.request ? cloneCreateSessionRequest(item.request) : {};
    const resolvedTitle = (sourceRequest.tabTitle || item.title || "").trim();
    setTitle(resolvedTitle);

    const resolvedType: SessionType = (sourceRequest.sessionType || item.sessionType) === "SSH_SHELL"
      ? "SSH_SHELL"
      : "LOCAL_PTY";

    if (resolvedType === "SSH_SHELL") {
      if (sourceRequest.ssh?.credentialId) {
        setSshCredentialId(sourceRequest.ssh.credentialId);
      }
      if (sourceRequest.ssh?.term && sourceRequest.ssh.term.trim()) {
        setSshTerm(sourceRequest.ssh.term.trim());
      }
      return;
    }

    const resolvedWorkdir = (sourceRequest.workdir || item.workdir || "").trim();
    if (resolvedWorkdir) {
      setWorkdir(resolvedWorkdir);
    }

    const resolvedToolId = (sourceRequest.toolId || item.toolId || "").trim();
    if (resolvedToolId === "terminal") {
      if (sourceRequest.command && sourceRequest.command.trim()) {
        setCommand(sourceRequest.command.trim());
      }
      if (sourceRequest.args) {
        setArgs(sourceRequest.args.join(" "));
      }
    }
  }

  function onSelectRecentSession(event: ChangeEvent<HTMLSelectElement>): void {
    const nextIndexValue = event.target.value;
    setSelectedRecentSessionIndex(nextIndexValue);
    if (!nextIndexValue) {
      return;
    }

    const item = recentSessions[Number.parseInt(nextIndexValue, 10)];
    if (!item) {
      return;
    }
    applyRecentToForm(item);
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");

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
      const resolvedWorkdir = workdir.trim() || selectedClient.defaultWorkdir || workdirTree?.currentPath || ".";
      payload = {
        sessionType: "LOCAL_PTY",
        clientId: selectedClient.id,
        toolId: selectedClient.id,
        tabTitle: titleText || resolvedWorkdir,
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
        tabTitle: titleText || (workdir.trim() || workdirTree?.currentPath || "."),
        command: command.trim() || "/bin/zsh",
        args: parsedArgs,
        workdir: workdir.trim() || workdirTree?.currentPath || "."
      };
    }

    try {
      await createSessionWithPayload(payload);
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
      title: sshCreateTitle.trim() || undefined,
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
      setSshCreateTitle("");
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
      <div className="new-session-tool-row">
        <select
          id="new-session-tool"
          className="new-session-tool-select"
          value={toolId}
          onChange={(event) => setToolId(event.target.value)}
        >
          {toolOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      {terminalClientsError && <div className="tree-status error">{terminalClientsError}</div>}

      <section className="recent-sessions-section">
        <div className="recent-sessions-head">
          <label className="field-label" htmlFor="new-session-recent">Recent {toolId}</label>
          <button
            type="button"
            className="ghost-btn recent-refresh-btn"
            onClick={() => void refreshRecentSessions(toolId)}
            disabled={recentSessionsLoading}
          >
            {recentSessionsLoading ? "Loading" : "Refresh"}
          </button>
        </div>
        {recentSessionsError && <div className="tree-status error">{recentSessionsError}</div>}
        <div className="recent-select-row">
          <select
            id="new-session-recent"
            className="recent-select"
            value={selectedRecentSessionIndex}
            onChange={onSelectRecentSession}
            disabled={recentSessionsLoading || createSessionMutation.isPending}
          >
            <option value="">Select recent session</option>
            {recentSessions.map((item, index) => (
              <option key={`${item.toolId}-${item.lastUsedAt}-${index}`} value={`${index}`}>
                {formatRecentSessionLabel(item)}
              </option>
            ))}
          </select>
        </div>
      </section>

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
            <label className="field-label" htmlFor="new-session-workdir-tree">Workdir</label>

            <div id="new-session-workdir-tree" className="workdir-tree" role="tree" onWheel={onWorkdirTreeWheel}>
              {!workdirTree && workdirLoading && <div className="tree-status">Loading workdir...</div>}
              {!workdirTree && !workdirLoading && !workdirError && <div className="tree-status">No directory data</div>}
              {workdirError && <div className="tree-status error">{workdirError}</div>}

              {workdirTree && (
                <div className="tree-list">
                  <button
                    type="button"
                    className={`tree-label tree-root ${workdir === workdirTree.rootPath ? "selected" : ""}`}
                    title={workdirTree.rootPath}
                    onClick={() => void onSelectRootWorkdir()}
                  >
                    <span className="tree-prefix">/</span>
                    <span className="tree-name">{workdirTree.rootPath}</span>
                  </button>

                  {(workdirLoadingMap[ROOT_WORKDIR_LOADING_KEY] || workdirLoadingMap[workdirTree.rootPath]) && (
                    <div className="tree-status tree-status-indented">Loading...</div>
                  )}

                  {visibleWorkdirEntries.length === 0 && !workdirLoading && !workdirError ? (
                    <div className="tree-status tree-status-indented">No directories</div>
                  ) : (
                    visibleWorkdirEntries.map((row) => (
                      <div key={row.entry.path}>
                        <button
                          type="button"
                          className={`tree-label ${workdir === row.entry.path ? "selected" : ""}`}
                          title={row.entry.path}
                          style={{ paddingInlineStart: `${8 + (row.depth + 1) * 16}px` }}
                          onClick={() => void onSelectWorkdirEntry(row.entry)}
                        >
                          <span className="tree-prefix">
                            {row.entry.hasChildren ? (workdirExpandedMap[row.entry.path] ? "v" : ">") : "-"}
                          </span>
                          <span className="tree-name">{row.entry.name}</span>
                        </button>
                        {workdirLoadingMap[row.entry.path] && (
                          <div
                            className="tree-status tree-status-indented"
                            style={{ paddingInlineStart: `${24 + (row.depth + 1) * 16}px` }}
                          >
                            Loading...
                          </div>
                        )}
                      </div>
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
                {formatSshCredentialOptionLabel(credential)}
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

          <label className="field-label" htmlFor="new-ssh-title">Title (optional)</label>
          <input
            id="new-ssh-title"
            value={sshCreateTitle}
            onChange={(event) => setSshCreateTitle(event.target.value)}
            placeholder="prod api machine"
          />

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
