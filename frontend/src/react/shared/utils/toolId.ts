import type { TerminalTab } from "../../features/tabs/useTabsStore";

export function normalizeToolId(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function isShellCapableTab(tab: TerminalTab | null): boolean {
  if (!tab) {
    return false;
  }
  if (tab.sessionType === "SSH_SHELL") {
    return true;
  }
  const toolId = normalizeToolId(tab.toolId);
  return toolId === "terminal" || toolId === "ssh";
}
