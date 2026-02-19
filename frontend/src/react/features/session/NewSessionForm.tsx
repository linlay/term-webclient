import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../shared/api/client";
import type { CreateSessionRequest } from "../../shared/api/types";

interface NewSessionFormProps {
  onCreated: (payload: { sessionId: string; wsUrl: string; title: string; clientId: string }) => void;
}

function randomClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseArgs(value: string): string[] {
  return value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function NewSessionForm({ onCreated }: NewSessionFormProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("/bin/zsh");
  const [args, setArgs] = useState("-l");
  const [workdir, setWorkdir] = useState(".");
  const [sessionType, setSessionType] = useState<"LOCAL_PTY" | "SSH_SHELL">("LOCAL_PTY");
  const [error, setError] = useState("");

  const createSessionMutation = useMutation({
    mutationFn: (payload: CreateSessionRequest) => apiClient.createSession(payload)
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (sessionType === "SSH_SHELL") {
      setError("React mode SSH creation will be migrated in next step. Use legacy mode for full SSH workflow.");
      return;
    }

    const clientId = randomClientId();

    try {
      const response = await createSessionMutation.mutateAsync({
        sessionType,
        clientId,
        tabTitle: title.trim() || "terminal",
        toolId: "terminal",
        command: command.trim() || "/bin/zsh",
        args: parseArgs(args),
        workdir: workdir.trim() || "."
      });

      onCreated({
        sessionId: response.sessionId,
        wsUrl: response.wsUrl,
        title: title.trim() || "terminal",
        clientId
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    }
  };

  return (
    <form className="react-new-session-form" onSubmit={onSubmit}>
      <div className="react-form-grid">
        <label htmlFor="react-session-type">Type</label>
        <select
          id="react-session-type"
          value={sessionType}
          onChange={(e) => setSessionType(e.target.value as "LOCAL_PTY" | "SSH_SHELL")}
        >
          <option value="LOCAL_PTY">LOCAL_PTY</option>
          <option value="SSH_SHELL">SSH_SHELL (legacy only)</option>
        </select>

        <label htmlFor="react-session-title">Title</label>
        <input
          id="react-session-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="terminal"
        />

        <label htmlFor="react-session-command">Command</label>
        <input
          id="react-session-command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="/bin/zsh"
        />

        <label htmlFor="react-session-args">Args</label>
        <input
          id="react-session-args"
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="-l"
        />

        <label htmlFor="react-session-workdir">Workdir</label>
        <input
          id="react-session-workdir"
          value={workdir}
          onChange={(e) => setWorkdir(e.target.value)}
          placeholder="."
        />
      </div>

      {error && <div className="react-form-error react-form-error-block">{error}</div>}

      <button type="submit" disabled={createSessionMutation.isPending}>
        {createSessionMutation.isPending ? "Creating..." : "Create Session"}
      </button>
    </form>
  );
}
