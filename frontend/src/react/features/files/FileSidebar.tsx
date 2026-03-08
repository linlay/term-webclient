import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../../shared/api/client";
import type { FileTreeEntryResponse, UploadConflictPolicy } from "../../shared/api/types";
import { useFileTransferStore, type UploadQueueItem } from "./useFileTransferStore";

type NoticeType = "info" | "warn" | "error" | "success";

interface FileSidebarProps {
  sessionId: string;
  fileRootPath: string;
  onNotice: (message: string, type?: NoticeType) => void;
}

function createUploadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isDirectory(entry: FileTreeEntryResponse | undefined): boolean {
  return entry?.type === "DIRECTORY";
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function triggerBrowserDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function FileSidebar({ sessionId, fileRootPath, onNotice }: FileSidebarProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const session = useFileTransferStore((state) => state.bySessionId[sessionId]);
  const initSession = useFileTransferStore((state) => state.initSession);
  const setTree = useFileTransferStore((state) => state.setTree);
  const setLoading = useFileTransferStore((state) => state.setLoading);
  const setFilterKeyword = useFileTransferStore((state) => state.setFilterKeyword);
  const clearSelection = useFileTransferStore((state) => state.clearSelection);
  const toggleSelectPath = useFileTransferStore((state) => state.toggleSelectPath);
  const enqueueUpload = useFileTransferStore((state) => state.enqueueUpload);
  const updateUpload = useFileTransferStore((state) => state.updateUpload);

  const currentPath = session?.currentPath || fileRootPath || ".";
  const parentPath = session?.parentPath || null;
  const entries = session?.entries || [];
  const selectedPaths = session?.selectedPaths || [];
  const filterKeyword = session?.filterKeyword || "";
  const uploadQueue = session?.uploadQueue || [];
  const loading = session?.loading || false;

  const filteredEntries = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    if (!keyword) {
      return entries;
    }
    return entries.filter((entry) => entry.name.toLowerCase().includes(keyword));
  }, [entries, filterKeyword]);

  const loadTree = useCallback(async (path?: string) => {
    setLoading(sessionId, true);
    try {
      const tree = await apiClient.getSessionFileTree(sessionId, path);
      setTree(sessionId, {
        currentPath: tree.currentPath,
        parentPath: tree.parentPath,
        entries: tree.entries
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Failed to load files", "error");
      setLoading(sessionId, false);
    }
  }, [onNotice, sessionId, setLoading, setTree]);

  useEffect(() => {
    initSession(sessionId, fileRootPath);
    void loadTree(fileRootPath);
  }, [fileRootPath, initSession, loadTree, sessionId]);

  async function uploadSingleFile(file: File, targetPath: string, conflictPolicy: UploadConflictPolicy): Promise<void> {
    const uploadId = createUploadId();
    const queueItem: UploadQueueItem = {
      id: uploadId,
      fileName: file.name,
      targetPath,
      conflictPolicy,
      size: file.size,
      progress: 0,
      status: "queued",
      savedPath: null,
      error: null,
      file,
      updatedAt: Date.now()
    };
    enqueueUpload(sessionId, queueItem);
    updateUpload(sessionId, uploadId, { status: "uploading", progress: 0, error: null });

    try {
      const response = await apiClient.uploadSessionFile(sessionId, {
        targetPath,
        conflictPolicy,
        file,
        onProgress: (progress) => {
          updateUpload(sessionId, uploadId, {
            status: "uploading",
            progress: progress.percent
          });
        }
      });
      const result = response.results[0];
      if (!result || result.status !== "SUCCESS") {
        updateUpload(sessionId, uploadId, {
          status: "failed",
          error: result?.error || "upload failed",
          progress: 0
        });
        return;
      }
      updateUpload(sessionId, uploadId, {
        status: "success",
        progress: 100,
        savedPath: result.savedPath,
        error: null
      });
      await loadTree(currentPath);
    } catch (error) {
      updateUpload(sessionId, uploadId, {
        status: "failed",
        error: error instanceof Error ? error.message : "upload failed",
        progress: 0
      });
    }
  }

  async function uploadFiles(files: FileList | File[]): Promise<void> {
    const fileArray = Array.isArray(files) ? files : Array.from(files);
    if (fileArray.length === 0) {
      return;
    }
    for (const file of fileArray) {
      // Upload sequentially so each item has stable progress and retry behavior.
      // eslint-disable-next-line no-await-in-loop
      await uploadSingleFile(file, currentPath, "rename");
    }
  }

  async function onRetryUpload(item: UploadQueueItem): Promise<void> {
    if (!item.file) {
      onNotice("Retry unavailable: file handle missing", "warn");
      return;
    }
    await uploadSingleFile(item.file, item.targetPath || currentPath, item.conflictPolicy || "rename");
  }

  async function createFolder(): Promise<void> {
    const name = window.prompt("Directory name");
    if (!name || !name.trim()) {
      return;
    }
    try {
      await apiClient.createSessionFileMkdir(sessionId, {
        parentPath: currentPath,
        name: name.trim()
      });
      await loadTree(currentPath);
      onNotice("Directory created", "success");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Failed to create directory", "error");
    }
  }

  async function downloadSelected(): Promise<void> {
    if (selectedPaths.length === 0) {
      onNotice("Select at least one file", "warn");
      return;
    }
    const entryMap = new Map(entries.map((entry) => [entry.path, entry]));
    const singlePath = selectedPaths[0];
    const singleEntry = entryMap.get(singlePath);
    const singleFileDownload = selectedPaths.length === 1 && !isDirectory(singleEntry);

    try {
      const ticket = await apiClient.createSessionDownloadTicket(sessionId, singleFileDownload
        ? { mode: "single", path: singlePath }
        : { mode: "archive", paths: selectedPaths, archiveName: "download.zip" });
      triggerBrowserDownload(apiClient.resolveDownloadUrl(ticket.downloadUrl));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Failed to start download", "error");
    }
  }

  function onEntryClick(entry: FileTreeEntryResponse, multi: boolean): void {
    if (entry.type === "DIRECTORY" && !multi) {
      void loadTree(entry.path);
      return;
    }
    toggleSelectPath(sessionId, entry.path, !multi);
  }

  if (collapsed) {
    return (
      <aside className="file-sidebar collapsed">
        <button type="button" className="file-collapse-btn" onClick={() => setCollapsed(false)}>Files</button>
      </aside>
    );
  }

  return (
    <aside className="file-sidebar">
      <div className="file-sidebar-head">
        <div className="file-current-path" title={currentPath}>{currentPath}</div>
        <div className="file-head-actions">
          <button type="button" onClick={() => void loadTree(currentPath)} disabled={loading}>刷新</button>
          <button
            type="button"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            上传
          </button>
          <button type="button" className="ghost-btn" onClick={() => setCollapsed(true)}>收起</button>
        </div>
      </div>

      <div className="file-search-row">
        <input
          type="text"
          placeholder="过滤文件名"
          value={filterKeyword}
          onChange={(event) => setFilterKeyword(sessionId, event.target.value)}
        />
      </div>

      <div
        className={`file-list ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragging) {
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) {
            return;
          }
          void uploadFiles(event.dataTransfer.files);
        }}
      >
        {parentPath && (
          <button
            type="button"
            className="file-entry file-entry-parent"
            onClick={() => {
              void loadTree(parentPath);
            }}
          >
            .. (up)
          </button>
        )}
        {filteredEntries.map((entry) => {
          const selected = selectedPaths.includes(entry.path);
          return (
            <button
              key={entry.path}
              type="button"
              className={`file-entry ${selected ? "selected" : ""}`}
              onClick={(event) => onEntryClick(entry, event.metaKey || event.ctrlKey || event.shiftKey)}
            >
              <span className="file-entry-name">
                {entry.type === "DIRECTORY" ? "[D]" : "[F]"} {entry.name}
              </span>
              <span className="file-entry-size">{entry.type === "DIRECTORY" ? "-" : formatBytes(entry.size)}</span>
            </button>
          );
        })}
        {filteredEntries.length === 0 && <div className="file-empty">No files</div>}
      </div>

      <div className="upload-queue">
        {uploadQueue.slice(-6).map((item) => (
          <div key={item.id} className={`upload-item ${item.status}`}>
            <div className="upload-item-title">{item.fileName}</div>
            <div className="upload-item-meta">
              <span>{item.status}</span>
              <span>{item.progress}%</span>
            </div>
            <div className="upload-progress-track">
              <div className="upload-progress-fill" style={{ width: `${item.progress}%` }} />
            </div>
            {item.error && <div className="upload-item-error">{item.error}</div>}
            {item.status === "failed" && (
              <button type="button" className="ghost-btn upload-retry-btn" onClick={() => void onRetryUpload(item)}>
                重试
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="file-sidebar-foot">
        <button type="button" onClick={() => void downloadSelected()} disabled={selectedPaths.length === 0}>下载</button>
        <button type="button" onClick={() => void createFolder()}>新建目录</button>
        <button type="button" className="ghost-btn" onClick={() => clearSelection(sessionId)}>清空选择</button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) {
            void uploadFiles(files);
          }
          event.currentTarget.value = "";
        }}
      />
    </aside>
  );
}
