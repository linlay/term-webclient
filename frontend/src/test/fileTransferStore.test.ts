import { beforeEach, describe, expect, it } from "vitest";
import { useFileTransferStore } from "../react/features/files/useFileTransferStore";

describe("useFileTransferStore", () => {
  beforeEach(() => {
    useFileTransferStore.setState({ bySessionId: {} });
  });

  it("initializes session and resets selection on path switch", () => {
    const store = useFileTransferStore.getState();
    store.initSession("s1", "/tmp");
    store.setTree("s1", {
      currentPath: "/tmp",
      parentPath: "/",
      entries: [
        { name: "a.txt", path: "/tmp/a.txt", type: "FILE", size: 1, mtime: 1, readable: true, writable: true },
        { name: "dir", path: "/tmp/dir", type: "DIRECTORY", size: 0, mtime: 1, readable: true, writable: true }
      ]
    });
    store.toggleSelectPath("s1", "/tmp/a.txt", false);
    expect(useFileTransferStore.getState().bySessionId.s1.selectedPaths).toEqual(["/tmp/a.txt"]);

    store.setTree("s1", {
      currentPath: "/tmp/dir",
      parentPath: "/tmp",
      entries: []
    });
    expect(useFileTransferStore.getState().bySessionId.s1.selectedPaths).toEqual([]);
  });

  it("tracks upload queue updates", () => {
    const store = useFileTransferStore.getState();
    store.initSession("s1", "/tmp");
    store.enqueueUpload("s1", {
      id: "u1",
      fileName: "a.txt",
      targetPath: "/tmp",
      conflictPolicy: "rename",
      size: 3,
      progress: 0,
      status: "queued",
      savedPath: null,
      error: null,
      file: null,
      updatedAt: Date.now()
    });
    store.updateUpload("s1", "u1", { status: "uploading", progress: 40 });
    const item = useFileTransferStore.getState().bySessionId.s1.uploadQueue[0];
    expect(item.status).toBe("uploading");
    expect(item.progress).toBe(40);
  });
});
