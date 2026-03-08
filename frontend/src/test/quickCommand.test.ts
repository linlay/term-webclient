import { describe, expect, it } from "vitest";
import { parseQuickCommand } from "../react/shared/terminal/quickCommand";

describe("parseQuickCommand", () => {
  it("supports cmd prefix", () => {
    expect(parseQuickCommand("cmd: ls -la")).toBe("ls -la\r");
  });

  it("supports input prefix", () => {
    expect(parseQuickCommand("input:raw")).toBe("raw");
  });

  it("supports key segments", () => {
    expect(parseQuickCommand("echo hi | key:enter")).toBe("echo hi\r");
  });
});
