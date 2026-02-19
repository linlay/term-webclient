import { create } from "zustand";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "exited" | "error";

export interface TerminalTab {
  localId: string;
  title: string;
  sessionId: string;
  wsUrl: string;
  clientId: string;
  status: ConnectionStatus;
  createdAt: string;
}

interface TabsState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  addTab: (tab: Omit<TerminalTab, "localId" | "status" | "createdAt">) => string;
  removeTab: (localId: string) => void;
  setActiveTab: (localId: string) => void;
  setTabStatus: (localId: string, status: ConnectionStatus) => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab(tab) {
    const localId = makeId();
    const next = {
      ...tab,
      localId,
      status: "connecting" as const,
      createdAt: new Date().toISOString()
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
  }
}));
