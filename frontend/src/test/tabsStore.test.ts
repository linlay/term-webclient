import { describe, expect, it } from "vitest";
import { useTabsStore } from "../react/features/tabs/useTabsStore";

describe("useTabsStore", () => {
  it("adds and removes tabs", () => {
    useTabsStore.setState({ tabs: [], activeTabId: null });

    const first = useTabsStore.getState().addTab({
      sessionId: "s1",
      wsUrl: "/ws/s1",
      clientId: "c1",
      title: "one",
      sessionType: "LOCAL_PTY",
      toolId: "terminal",
      workdir: ".",
      sshCredentialId: null,
      createRequest: null
    });

    const second = useTabsStore.getState().addTab({
      sessionId: "s2",
      wsUrl: "/ws/s2",
      clientId: "c2",
      title: "two",
      sessionType: "LOCAL_PTY",
      toolId: "terminal",
      workdir: ".",
      sshCredentialId: null,
      createRequest: null
    });

    expect(useTabsStore.getState().tabs).toHaveLength(2);
    expect(useTabsStore.getState().activeTabId).toBe(second);
    expect(useTabsStore.getState().tabs[0].lost).toBe(false);
    expect(useTabsStore.getState().tabs[0].exitCode).toBe("-");

    useTabsStore.getState().removeTab(second);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeTabId).toBe(first);
  });

  it("updates tab lost/exit code metadata", () => {
    useTabsStore.setState({ tabs: [], activeTabId: null });

    const tabId = useTabsStore.getState().addTab({
      sessionId: "s1",
      wsUrl: "/ws/s1",
      clientId: "c1",
      title: "one",
      sessionType: "LOCAL_PTY",
      toolId: "terminal",
      workdir: ".",
      sshCredentialId: null,
      createRequest: null
    });

    useTabsStore.getState().setTabLost(tabId, true);
    useTabsStore.getState().setTabExitCode(tabId, "130");

    const tab = useTabsStore.getState().tabs.find((item) => item.localId === tabId);
    expect(tab?.lost).toBe(true);
    expect(tab?.exitCode).toBe("130");
  });
});
