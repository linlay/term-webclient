import { useEffect, useState } from "react";
import type { TerminalTab } from "../../features/tabs/useTabsStore";
import { apiClient } from "../api/client";
import { COPILOT_REFRESH_MS } from "../config/env";
import type { SideTab } from "./copilotTypes";

interface UseSummaryStateOptions {
  activeTab: TerminalTab | null;
  isCopilotOpen: boolean;
  sideTab: SideTab;
}

export function useSummaryState({ activeTab, isCopilotOpen, sideTab }: UseSummaryStateOptions) {
  const [summaryContext, setSummaryContext] = useState("");
  const [summaryScreenText, setSummaryScreenText] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);

  async function refreshSummary(): Promise<void> {
    if (!activeTab?.sessionId) {
      setSummaryContext("");
      setSummaryScreenText("");
      setSummaryError("No active tab");
      return;
    }
    setSummaryLoading(true);
    setSummaryError("");
    try {
      const [context, screen] = await Promise.all([
        apiClient.getSessionContext(activeTab.sessionId),
        apiClient.getSessionScreenText(activeTab.sessionId)
      ]);
      setSummaryContext(JSON.stringify(context, null, 2));
      setSummaryScreenText(screen.text || "");
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Failed to load summary");
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    if (sideTab !== "summary" || !isCopilotOpen) {
      return;
    }
    void refreshSummary();
    const timer = window.setInterval(() => {
      void refreshSummary();
    }, COPILOT_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeTab?.sessionId, isCopilotOpen, sideTab]);

  return {
    summaryContext,
    summaryScreenText,
    summaryError,
    summaryLoading,
    refreshSummary
  };
}
