import { describe, expect, it } from "vitest";
import { replaySnapshotChunks } from "../react/features/terminal/snapshot";

describe("replaySnapshotChunks", () => {
  it("replays only new chunks and returns latest seq", () => {
    const writes: string[] = [];
    const next = replaySnapshotChunks(
      [
        { seq: 2, data: "old" },
        { seq: 3, data: "new-a" },
        { seq: 4, data: "new-b" }
      ],
      2,
      (data) => {
        writes.push(data);
      }
    );

    expect(writes).toEqual(["new-a", "new-b"]);
    expect(next).toBe(4);
  });
});
