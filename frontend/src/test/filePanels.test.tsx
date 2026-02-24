import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileSidebar } from "../react/features/files/FileSidebar";
import { MobileFileSheet } from "../react/features/files/MobileFileSheet";
import { useFileTransferStore } from "../react/features/files/useFileTransferStore";
import { apiClient } from "../react/shared/api/client";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  useFileTransferStore.setState({ bySessionId: {} });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
  container = null;
  vi.restoreAllMocks();
});

function render(node: JSX.Element): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
}

describe("file panels", () => {
  it("FileSidebar requests single-file download ticket", async () => {
    vi.spyOn(apiClient, "getSessionFileTree").mockResolvedValue({
      currentPath: "/tmp",
      parentPath: "/",
      entries: [
        { name: "a.txt", path: "/tmp/a.txt", type: "FILE", size: 1, mtime: 1, readable: true, writable: true }
      ]
    });
    const createTicketSpy = vi.spyOn(apiClient, "createSessionDownloadTicket").mockResolvedValue({
      ticket: "tk",
      downloadUrl: "/term/api/sessions/s1/files/download?ticket=tk",
      expiresAt: "2026-02-24T00:00:00Z"
    });
    vi.spyOn(apiClient, "resolveDownloadUrl").mockReturnValue("/term/api/sessions/s1/files/download?ticket=tk");
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <FileSidebar
        sessionId="s1"
        fileRootPath="/tmp"
        onNotice={vi.fn()}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const fileButton = Array.from(container?.querySelectorAll(".file-entry") || []).find(
      (item) => (item as HTMLElement).textContent?.includes("a.txt")
    ) as HTMLButtonElement | undefined;
    expect(fileButton).toBeTruthy();
    act(() => {
      fileButton?.click();
    });

    const downloadButton = Array.from(container?.querySelectorAll(".file-sidebar-foot button") || [])[0] as HTMLButtonElement;
    act(() => {
      downloadButton.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(createTicketSpy).toHaveBeenCalledWith("s1", { mode: "single", path: "/tmp/a.txt" });
    expect(anchorClickSpy).toHaveBeenCalled();
  });

  it("MobileFileSheet supports multi-select archive ticket", async () => {
    vi.spyOn(apiClient, "getSessionFileTree").mockResolvedValue({
      currentPath: "/tmp",
      parentPath: "/",
      entries: [
        { name: "a.txt", path: "/tmp/a.txt", type: "FILE", size: 1, mtime: 1, readable: true, writable: true },
        { name: "b.txt", path: "/tmp/b.txt", type: "FILE", size: 1, mtime: 1, readable: true, writable: true }
      ]
    });
    const createTicketSpy = vi.spyOn(apiClient, "createSessionDownloadTicket").mockResolvedValue({
      ticket: "tk",
      downloadUrl: "/term/api/sessions/s1/files/download-archive?ticket=tk",
      expiresAt: "2026-02-24T00:00:00Z"
    });
    vi.spyOn(apiClient, "resolveDownloadUrl").mockReturnValue("/term/api/sessions/s1/files/download-archive?ticket=tk");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(
      <MobileFileSheet
        open={true}
        sessionId="s1"
        fileRootPath="/tmp"
        onClose={vi.fn()}
        onNotice={vi.fn()}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    useFileTransferStore.getState().setMultiSelectMode("s1", true);

    const items = Array.from(container?.querySelectorAll(".mobile-file-item") || []) as HTMLButtonElement[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    act(() => {
      items[0].click();
    });
    act(() => {
      items[1].click();
    });

    const downloadButton = Array.from(container?.querySelectorAll(".mobile-files-foot button") || [])[0] as HTMLButtonElement;
    act(() => {
      downloadButton.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(createTicketSpy).toHaveBeenCalledWith("s1", {
      mode: "archive",
      paths: ["/tmp/a.txt", "/tmp/b.txt"],
      archiveName: "download.zip"
    });
  });
});
