import { describe, expect, it } from "vitest";
import { buildAssistSuggestions } from "../react/shared/copilot/assistMock";

describe("buildAssistSuggestions", () => {
  it("prioritizes git suggestions from screen text and question", () => {
    const suggestions = buildAssistSuggestions(
      "How do I inspect the repo changes?",
      "On branch main\nmodified: frontend/src/react/App.tsx\nuntracked files present"
    );

    expect(suggestions[0]?.command).toBe("git status --short");
    expect(suggestions.some((item) => item.command === "git diff --stat")).toBe(true);
  });

  it("falls back to safe defaults when context is weak", () => {
    const suggestions = buildAssistSuggestions("What should I check?", "");

    expect(suggestions.map((item) => item.command)).toEqual([
      "pwd",
      "ls -la",
      "git status --short",
      "npm test"
    ]);
  });
});
