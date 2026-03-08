import { create } from "zustand";
import type { CreateSessionRequest, SessionType } from "../../shared/api/types";
import { generateId } from "../../shared/utils/id";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "exited" | "error";

export interface TerminalTab {
  localId: string;
  title: string;
  sessionId: string;
  wsUrl: string;
  clientId: string;
  status: ConnectionStatus;
  createdAt: string;
  sessionType: SessionType;
  toolId: string;
  workdir: string;
  fileRootPath: string;
  sshCredentialId: string | null;
  createRequest: CreateSessionRequest | null;
  agentRunId: string | null;
  lost?: boolean;
  exitCode?: string;
}

export type AddTabInput = Omit<TerminalTab, "localId" | "status" | "createdAt" | "agentRunId" | "lost" | "exitCode"> & {
  status?: ConnectionStatus;
  createdAt?: string;
  agentRunId?: string | null;
  lost?: boolean;
  exitCode?: string;
};

interface TabsState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  setTabs: (tabs: TerminalTab[]) => void;
  addTab: (tab: AddTabInput) => string;
  removeTab: (localId: string) => void;
  setActiveTab: (localId: string) => void;
  setTabStatus: (localId: string, status: ConnectionStatus) => void;
  setTabAgentRunId: (localId: string, runId: string | null) => void;
  setTabLost: (localId: string, lost: boolean) => void;
  setTabExitCode: (localId: string, exitCode: string) => void;
  replaceTabSession: (
    localId: string,
    replacement: Pick<TerminalTab, "sessionId" | "wsUrl" | "clientId" | "createRequest">
  ) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  setTabs(tabs) {
    set((state) => {
      const nextActive = state.activeTabId && tabs.some((tab) => tab.localId === state.activeTabId)
        ? state.activeTabId
        : (tabs[0]?.localId ?? null);
      return {
        tabs,
        activeTabId: nextActive
      };
    });
  },

  addTab(tab) {
    const localId = generateId();
    const next: TerminalTab = {
      ...tab,
      localId,
      status: tab.status ?? "connecting",
      createdAt: tab.createdAt ?? new Date().toISOString(),
      agentRunId: tab.agentRunId ?? null,
      lost: tab.lost ?? false,
      exitCode: tab.exitCode ?? "-"
    };

    set((state) => ({
      tabs: [...state.tabs, next],
      activeTabId: localId
    }));

    return localId;
  },

  removeTab(localId) {
    set((state) => {
      const nextTabs = state.tabs.filter((tab) => tab.localId !== localId);
      const nextActive = state.activeTabId === localId
        ? (nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].localId : null)
        : state.activeTabId;

      return {
        tabs: nextTabs,
        activeTabId: nextActive
      };
    });
  },

  setActiveTab(localId) {
    const exists = get().tabs.some((tab) => tab.localId === localId);
    if (!exists) {
      return;
    }
    set({ activeTabId: localId });
  },

  setTabStatus(localId, status) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (
        tab.localId === localId ? { ...tab, status } : tab
      ))
    }));
  },

  setTabAgentRunId(localId, runId) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (
        tab.localId === localId ? { ...tab, agentRunId: runId } : tab
      ))
    }));
  },

  setTabLost(localId, lost) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (
        tab.localId === localId ? { ...tab, lost } : tab
      ))
    }));
  },

  setTabExitCode(localId, exitCode) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (
        tab.localId === localId ? { ...tab, exitCode } : tab
      ))
    }));
  },

  replaceTabSession(localId, replacement) {
    set((state) => ({
      tabs: state.tabs.map((tab) => (
        tab.localId === localId
          ? {
            ...tab,
            ...replacement,
            status: "connecting",
            agentRunId: null,
            lost: false,
            exitCode: "-"
          }
          : tab
      ))
    }));
  }
}));
