import { useCallback, useEffect, useMemo, useRef } from "react";
import { apiClient } from "../../shared/api/client";
import type { FileTreeEntryResponse } from "../../shared/api/types";
import { useFileTransferStore, type UploadQueueItem } from "./useFileTransferStore";

type NoticeType = "info" | "warn" | "error" | "success";

interface MobileFileSheetProps {
  open: boolean;
  sessionId: string;
  fileRootPath: string;
  onClose: () => void;
  onNotice: (message: string, type?: NoticeType) => void;
}

function createUploadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

function breadcrumbPaths(path: string): Array<{ label: string; value: string }> {
  const normalized = (path || "").trim();
  if (!normalized) {
    return [{ label: ".", value: "." }];
  }
  if (normalized === "/") {
    return [{ label: "/", value: "/" }];
  }
  const absolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);
  const crumbs: Array<{ label: string; value: string }> = [];
  let cursor = absolute ? "" : "";
  if (absolute) {
    crumbs.push({ label: "/", value: "/" });
  }
  for (const part of parts) {
    if (!cursor || cursor === "/") {
      cursor = absolute ? `/${part}` : part;
    } else {
      cursor = `${cursor}/${part}`;
    }
    crumbs.push({ label: part, value: cursor });
  }
  return crumbs.length > 0 ? crumbs : [{ label: ".", value: "." }];
}

export function MobileFileSheet({ open, sessionId, fileRootPath, onClose, onNotice }: MobileFileSheetProps): JSX.Element | null {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const session = useFileTransferStore((state) => state.bySessionId[sessionId]);
  const initSession = useFileTransferStore((state) => state.initSession);
  const setTree = useFileTransferStore((state) => state.setTree);
  const setLoading = useFileTransferStore((state) => state.setLoading);
  const toggleSelectPath = useFileTransferStore((state) => state.toggleSelectPath);
  const clearSelection = useFileTransferStore((state) => state.clearSelection);
  const setMultiSelectMode = useFileTransferStore((state) => state.setMultiSelectMode);
  const enqueueUpload = useFileTransferStore((state) => state.enqueueUpload);
  const updateUpload = useFileTransferStore((state) => state.updateUpload);

  const currentPath = session?.currentPath || fileRootPath || ".";
  const entries = session?.entries || [];
  const selectedPaths = session?.selectedPaths || [];
  const uploadQueue = session?.uploadQueue || [];
  const loading = session?.loading || false;
  const multiSelectMode = session?.multiSelectMode || false;

  const breadcrumbs = useMemo(() => breadcrumbPaths(currentPath), [currentPath]);

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
    if (!open) {
      return;
    }
    initSession(sessionId, fileRootPath);
    void loadTree(currentPath || fileRootPath);
  }, [currentPath, fileRootPath, initSession, loadTree, open, sessionId]);

  function clearLongPressTimer(): void {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  async function uploadSingleFile(file: File): Promise<void> {
    const uploadId = createUploadId();
    const queueItem: UploadQueueItem = {
      id: uploadId,
      fileName: file.name,
      targetPath: currentPath,
      conflictPolicy: "rename",
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
        targetPath: currentPath,
        conflictPolicy: "rename",
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
        savedPath: result.savedPath,
        progress: 100,
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
    for (const file of fileArray) {
      // eslint-disable-next-line no-await-in-loop
      await uploadSingleFile(file);
    }
  }

  async function onRetryUpload(item: UploadQueueItem): Promise<void> {
    if (!item.file) {
      onNotice("Retry unavailable", "warn");
      return;
    }
    await uploadSingleFile(item.file);
  }

  async function downloadSelected(): Promise<void> {
    if (selectedPaths.length === 0) {
      onNotice("Select files first", "warn");
      return;
    }
    const entryMap = new Map(entries.map((entry) => [entry.path, entry]));
    const single = selectedPaths.length === 1 ? entryMap.get(selectedPaths[0]) : undefined;
    const isSingleFile = selectedPaths.length === 1 && single?.type !== "DIRECTORY";
    try {
      const ticket = await apiClient.createSessionDownloadTicket(sessionId, isSingleFile
        ? { mode: "single", path: selectedPaths[0] }
        : { mode: "archive", paths: selectedPaths, archiveName: "download.zip" });
      triggerBrowserDownload(apiClient.resolveDownloadUrl(ticket.downloadUrl));
      onNotice("Download started", "success");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Failed to download", "error");
    }
  }

  function onEntryTap(entry: FileTreeEntryResponse): void {
    if (!multiSelectMode && entry.type === "DIRECTORY") {
      void loadTree(entry.path);
      return;
    }
    toggleSelectPath(sessionId, entry.path, !multiSelectMode);
  }

  if (!open) {
    return null;
  }

  return (
    <div className="mobile-files-sheet-wrap">
      <div className="mobile-files-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="mobile-files-sheet" role="dialog" aria-label="Files">
        <div className="mobile-files-head">
          <div className="mobile-files-title">Files</div>
          <button type="button" className="ghost-btn" onClick={onClose}>关闭</button>
        </div>

        <div className="mobile-files-breadcrumb">
          {breadcrumbs.map((crumb) => (
            <button
              key={`${crumb.label}-${crumb.value}`}
              type="button"
              className="ghost-btn"
              onClick={() => {
                void loadTree(crumb.value);
              }}
            >
              {crumb.label}
            </button>
          ))}
        </div>

        <div className="mobile-files-toolbar">
          <button type="button" onClick={() => fileInputRef.current?.click()}>上传</button>
          <button type="button" onClick={() => void loadTree(currentPath)} disabled={loading}>刷新</button>
          <button type="button" className="ghost-btn" onClick={() => clearSelection(sessionId)}>取消选择</button>
        </div>

        <div className="mobile-files-list">
          {entries.map((entry) => {
            const selected = selectedPaths.includes(entry.path);
            return (
              <button
                key={entry.path}
                type="button"
                className={`mobile-file-item ${selected ? "selected" : ""}`}
                onTouchStart={() => {
                  clearLongPressTimer();
                  longPressTimerRef.current = window.setTimeout(() => {
                    setMultiSelectMode(sessionId, true);
                    toggleSelectPath(sessionId, entry.path, false);
                    longPressTimerRef.current = null;
                  }, 380);
                }}
                onTouchEnd={() => {
                  clearLongPressTimer();
                }}
                onTouchCancel={() => {
                  clearLongPressTimer();
                }}
                onClick={() => onEntryTap(entry)}
              >
                <span>{entry.type === "DIRECTORY" ? "[D]" : "[F]"} {entry.name}</span>
              </button>
            );
          })}
          {entries.length === 0 && <div className="file-empty">No files</div>}
        </div>

        <div className="mobile-upload-list">
          {uploadQueue.slice(-4).map((item) => (
            <div key={item.id} className="upload-item">
              <div className="upload-item-title">{item.fileName}</div>
              <div className="upload-progress-track">
                <div className="upload-progress-fill" style={{ width: `${item.progress}%` }} />
              </div>
              {item.status === "failed" && (
                <button type="button" className="ghost-btn upload-retry-btn" onClick={() => void onRetryUpload(item)}>
                  重试
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mobile-files-foot">
          <button type="button" onClick={() => void downloadSelected()} disabled={selectedPaths.length === 0}>下载</button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              clearSelection(sessionId);
              setMultiSelectMode(sessionId, false);
            }}
          >
            取消选择
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
              void uploadFiles(files);
            }
            event.currentTarget.value = "";
          }}
        />
      </div>
    </div>
  );
}
