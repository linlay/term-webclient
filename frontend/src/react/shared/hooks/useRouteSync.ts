import { useCallback, useEffect, useState } from "react";
import type { TerminalTab } from "../../features/tabs/useTabsStore";
import {
  buildRouteSearch,
  parseRouteIntent,
  shouldSyncRouteSessionFromActive,
  writeRouteSearch,
  type RouteIntent,
  type RouteIntentPatch
} from "../routing/routeIntent";

interface UseRouteSyncOptions {
  tabs: TerminalTab[];
  activeTabId: string | null;
  setActiveTab: (localId: string) => void;
}

export function useRouteSync({ tabs, activeTabId, setActiveTab }: UseRouteSyncOptions) {
  const [routeIntent, setRouteIntent] = useState<RouteIntent>(() => parseRouteIntent(window.location.search));
  const [isNewWindowOpen, setIsNewWindowOpen] = useState(false);

  const applyRoutePatch = useCallback((patch: RouteIntentPatch, mode: "replace" | "push" = "replace") => {
    const currentSearch = window.location.search;
    const nextSearch = buildRouteSearch(currentSearch, patch);
    if (nextSearch !== currentSearch) {
      writeRouteSearch(patch, mode);
    }
    setRouteIntent(parseRouteIntent(nextSearch));
    return nextSearch;
  }, []);

  const selectTabAndSyncRoute = useCallback((localId: string) => {
    const selectedTab = tabs.find((tab) => tab.localId === localId);
    if (!selectedTab) {
      return;
    }
    setActiveTab(localId);
    applyRoutePatch({ sessionId: selectedTab.sessionId }, "replace");
  }, [applyRoutePatch, setActiveTab, tabs]);

  const openNewWindowFromUi = useCallback(() => {
    applyRoutePatch({ openNewSession: true });
    setIsNewWindowOpen(true);
  }, [applyRoutePatch]);

  const closeNewWindow = useCallback(() => {
    applyRoutePatch({ openNewSession: null, openNonce: null });
    setIsNewWindowOpen(false);
  }, [applyRoutePatch]);

  useEffect(() => {
    const onPopState = () => {
      setRouteIntent(parseRouteIntent(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (!routeIntent.sessionId) {
      return;
    }
    const matchedTab = tabs.find((tab) => tab.sessionId === routeIntent.sessionId);
    if (!matchedTab || matchedTab.localId === activeTabId) {
      return;
    }
    setActiveTab(matchedTab.localId);
  }, [activeTabId, routeIntent.sessionId, setActiveTab, tabs]);

  useEffect(() => {
    setIsNewWindowOpen(routeIntent.openNewSession);
  }, [routeIntent.openNewSession]);

  useEffect(() => {
    const activeSessionId = tabs.find((tab) => tab.localId === activeTabId)?.sessionId;
    if (!activeSessionId) {
      return;
    }
    if (!shouldSyncRouteSessionFromActive(activeSessionId, routeIntent.sessionId, tabs.map((tab) => tab.sessionId))) {
      return;
    }
    applyRoutePatch({ sessionId: activeSessionId }, "replace");
  }, [activeTabId, applyRoutePatch, routeIntent.sessionId, tabs]);

  return {
    routeIntent,
    isNewWindowOpen,
    setIsNewWindowOpen,
    applyRoutePatch,
    selectTabAndSyncRoute,
    openNewWindowFromUi,
    closeNewWindow
  };
}
