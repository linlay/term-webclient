export type AssistConfidence = "high" | "medium" | "mock";

export interface AssistSuggestion {
  id: string;
  command: string;
  reason: string;
  confidence: AssistConfidence;
}

interface SuggestionTemplate {
  command: string;
  reason: string;
  confidence: AssistConfidence;
}

function createSuggestionId(command: string): string {
  return command.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9._/-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function pushUniqueSuggestion(target: SuggestionTemplate[], suggestion: SuggestionTemplate): void {
  if (target.some((item) => item.command === suggestion.command)) {
    return;
  }
  target.push(suggestion);
}

function resolveKeywordGrep(question: string, screenText: string): string | null {
  const combinedTokens = tokenize(`${question} ${screenText}`);
  const candidate = combinedTokens.find((token) => {
    if (token.length < 3) {
      return false;
    }
    if (/^\d+$/.test(token)) {
      return false;
    }
    return ![
      "error",
      "failed",
      "warning",
      "docker",
      "compose",
      "build",
      "status",
      "branch",
      "commit",
      "package",
      "script",
      "terminal"
    ].includes(token);
  });
  return candidate || null;
}

export function buildAssistSuggestions(question: string, screenText: string): AssistSuggestion[] {
  const trimmedQuestion = question.trim();
  const trimmedScreenText = screenText.trim();
  const combined = `${trimmedQuestion}\n${trimmedScreenText}`.toLowerCase();
  const suggestions: SuggestionTemplate[] = [];

  if (includesAny(combined, ["git", "commit", "branch", "merge", "rebase", ".git", "untracked", "modified"])) {
    pushUniqueSuggestion(suggestions, {
      command: "git status --short",
      reason: "Check the current repository state before taking the next action.",
      confidence: "high"
    });
    pushUniqueSuggestion(suggestions, {
      command: "git diff --stat",
      reason: "Summarize pending changes without dumping the full diff.",
      confidence: "medium"
    });
    pushUniqueSuggestion(suggestions, {
      command: "git log --oneline -5",
      reason: "Review recent commits when the question references branch or history issues.",
      confidence: "medium"
    });
  }

  if (includesAny(combined, ["npm", "node", "package.json", "pnpm", "yarn", "vite", "vitest", "script"])) {
    pushUniqueSuggestion(suggestions, {
      command: "npm test",
      reason: "Validate the frontend or Node workflow from the current workspace state.",
      confidence: "high"
    });
    pushUniqueSuggestion(suggestions, {
      command: "npm run build",
      reason: "Check whether the current code compiles into a production build.",
      confidence: "medium"
    });
    pushUniqueSuggestion(suggestions, {
      command: "npm run dev",
      reason: "Start the local app when the question is about runtime behavior or UI state.",
      confidence: "mock"
    });
  }

  if (includesAny(combined, ["go", "golang", "go.mod", "go.sum", "panic", "test.go", "package main"])) {
    pushUniqueSuggestion(suggestions, {
      command: "go test ./...",
      reason: "Run the Go test suite to surface compile or behavior regressions.",
      confidence: "high"
    });
    pushUniqueSuggestion(suggestions, {
      command: "go build ./...",
      reason: "Verify the code builds even if the failing path does not have tests.",
      confidence: "medium"
    });
  }

  if (includesAny(combined, ["docker", "container", "image", "compose"])) {
    pushUniqueSuggestion(suggestions, {
      command: "docker ps",
      reason: "Inspect which containers are currently running.",
      confidence: "high"
    });
    pushUniqueSuggestion(suggestions, {
      command: "docker compose ps",
      reason: "Check service-level status for compose-managed workloads.",
      confidence: "medium"
    });
    pushUniqueSuggestion(suggestions, {
      command: "docker compose logs --tail=100",
      reason: "Pull recent logs when the question sounds like a runtime failure.",
      confidence: "medium"
    });
  }

  if (includesAny(combined, ["log", "trace", "exception", "stderr", "stdout"])) {
    pushUniqueSuggestion(suggestions, {
      command: "tail -n 200 ./logs/app.log",
      reason: "Inspect recent logs if the project writes to a conventional log file.",
      confidence: "mock"
    });
  }

  if (includesAny(combined, ["file", "path", "directory", "folder", "where", "在哪", "目录"])) {
    pushUniqueSuggestion(suggestions, {
      command: "pwd",
      reason: "Confirm the current working directory before navigating further.",
      confidence: "high"
    });
    pushUniqueSuggestion(suggestions, {
      command: "ls -la",
      reason: "List the current directory contents and file metadata.",
      confidence: "high"
    });
  }

  if (includesAny(combined, ["error", "failed", "fail", "bug", "问题", "报错"])) {
    const keyword = resolveKeywordGrep(trimmedQuestion, trimmedScreenText);
    if (keyword) {
      pushUniqueSuggestion(suggestions, {
        command: `grep -RIn "${keyword}" .`,
        reason: "Search the workspace for the most likely error keyword from the recent screen text.",
        confidence: "medium"
      });
    }
  }

  const fallbacks: SuggestionTemplate[] = [
    {
      command: "pwd",
      reason: "Anchor on the current directory when there is not enough context yet.",
      confidence: "mock"
    },
    {
      command: "ls -la",
      reason: "Inspect the local workspace state with a safe default command.",
      confidence: "mock"
    },
    {
      command: "git status --short",
      reason: "Check whether the workspace is inside a git repo and whether files changed.",
      confidence: "mock"
    },
    {
      command: "npm test",
      reason: "Use a common verification command when the question does not map to a stronger hint.",
      confidence: "mock"
    }
  ];

  for (const fallback of fallbacks) {
    if (suggestions.length >= 4) {
      break;
    }
    pushUniqueSuggestion(suggestions, fallback);
  }

  return suggestions.slice(0, 4).map((suggestion) => ({
    id: createSuggestionId(suggestion.command),
    command: suggestion.command,
    reason: suggestion.reason,
    confidence: suggestion.confidence
  }));
}
