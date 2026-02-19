import { describe, expect, it } from "vitest";
import { useTabsStore } from "../react/features/tabs/useTabsStore";

describe("useTabsStore", () => {
  it("adds and removes tabs", () => {
    useTabsStore.setState({ tabs: [], activeTabId: null });

    const first = useTabsStore.getState().addTab({
      sessionId: "s1",
      wsUrl: "/ws/s1",
      clientId: "c1",
      title: "one"
    });

    const second = useTabsStore.getState().addTab({
      sessionId: "s2",
      wsUrl: "/ws/s2",
      clientId: "c2",
      title: "two"
    });

    expect(useTabsStore.getState().tabs).toHaveLength(2);
    expect(useTabsStore.getState().activeTabId).toBe(second);

    useTabsStore.getState().removeTab(second);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeTabId).toBe(first);
  });
});
