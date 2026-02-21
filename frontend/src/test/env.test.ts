import { describe, expect, it } from "vitest";
import { apiPath, apiPrefix, toWsUrl, wsPrefix } from "../react/shared/config/env";

describe("env path helpers", () => {
  it("uses term prefixes by default", () => {
    expect(apiPrefix("/term/")).toBe("/term/api");
    expect(wsPrefix("/term/")).toBe("/term/ws");
    expect(apiPath("/sessions", "/term/")).toBe("/term/api/sessions");
    expect(toWsUrl("/ws/s1?clientId=c1", "/term/")).toContain("/term/ws/s1?clientId=c1");
  });

  it("uses appterm prefixes in app mode", () => {
    expect(apiPrefix("/appterm/")).toBe("/appterm/api");
    expect(wsPrefix("/appterm/")).toBe("/appterm/ws");
    expect(apiPath("/sessions", "/appterm/")).toBe("/appterm/api/sessions");
    expect(toWsUrl("/ws/s1?clientId=c1", "/appterm/")).toContain("/appterm/ws/s1?clientId=c1");
  });

  it("keeps absolute websocket urls unchanged", () => {
    expect(toWsUrl("wss://example.com/ws/s1")).toBe("wss://example.com/ws/s1");
  });
});
