import { create } from "zustand";
import type { FileTreeEntryResponse, UploadConflictPolicy } from "../../shared/api/types";

export type UploadItemStatus = "queued" | "uploading" | "success" | "failed";

export interface UploadQueueItem {
  id: string;
  fileName: string;
  targetPath: string;
  conflictPolicy: UploadConflictPolicy;
  size: number;
  progress: number;
  status: UploadItemStatus;
  savedPath: string | null;
  error: string | null;
  file: File | null;
  updatedAt: number;
}

export interface FileSessionState {
  fileRootPath: string;
  currentPath: string;
  parentPath: string | null;
  entries: FileTreeEntryResponse[];
  filterKeyword: string;
  selectedPaths: string[];
  uploadQueue: UploadQueueItem[];
  loading: boolean;
  multiSelectMode: boolean;
  lastRefreshedAt: number;
}

interface FileTransferState {
  bySessionId: Record<string, FileSessionState>;
  initSession: (sessionId: string, fileRootPath: string) => void;
  setTree: (sessionId: string, payload: { currentPath: string; parentPath: string | null; entries: FileTreeEntryResponse[] }) => void;
  setLoading: (sessionId: string, loading: boolean) => void;
  setFilterKeyword: (sessionId: string, keyword: string) => void;
  clearSelection: (sessionId: string) => void;
  toggleSelectPath: (sessionId: string, path: string, replace: boolean) => void;
  setSelectedPaths: (sessionId: string, paths: string[]) => void;
  setMultiSelectMode: (sessionId: string, enabled: boolean) => void;
  enqueueUpload: (sessionId: string, item: UploadQueueItem) => void;
  updateUpload: (sessionId: string, uploadId: string, patch: Partial<UploadQueueItem>) => void;
  removeUpload: (sessionId: string, uploadId: string) => void;
}

function createInitialSession(fileRootPath: string): FileSessionState {
  return {
    fileRootPath,
    currentPath: fileRootPath,
    parentPath: null,
    entries: [],
    filterKeyword: "",
    selectedPaths: [],
    uploadQueue: [],
    loading: false,
    multiSelectMode: false,
    lastRefreshedAt: 0
  };
}

function withSessionState(
  state: FileTransferState,
  sessionId: string,
  fallbackRootPath = "."
): FileSessionState {
  return state.bySessionId[sessionId] || createInitialSession(fallbackRootPath);
}

export const useFileTransferStore = create<FileTransferState>((set) => ({
  bySessionId: {},

  initSession(sessionId, fileRootPath) {
    const rootPath = (fileRootPath || "").trim() || ".";
    set((state) => {
      if (state.bySessionId[sessionId]) {
        return state;
      }
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: createInitialSession(rootPath)
        }
      };
    });
  },

  setTree(sessionId, payload) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            currentPath: payload.currentPath,
            parentPath: payload.parentPath,
            entries: payload.entries,
            selectedPaths: [],
            multiSelectMode: false,
            lastRefreshedAt: Date.now(),
            loading: false
          }
        }
      };
    });
  },

  setLoading(sessionId, loading) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            loading
          }
        }
      };
    });
  },

  setFilterKeyword(sessionId, keyword) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            filterKeyword: keyword
          }
        }
      };
    });
  },

  clearSelection(sessionId) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            selectedPaths: [],
            multiSelectMode: false
          }
        }
      };
    });
  },

  toggleSelectPath(sessionId, path, replace) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      const existing = current.selectedPaths.includes(path);
      let nextPaths: string[];
      if (replace) {
        nextPaths = existing ? [] : [path];
      } else if (existing) {
        nextPaths = current.selectedPaths.filter((item) => item !== path);
      } else {
        nextPaths = [...current.selectedPaths, path];
      }
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            selectedPaths: nextPaths
          }
        }
      };
    });
  },

  setSelectedPaths(sessionId, paths) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            selectedPaths: paths
          }
        }
      };
    });
  },

  setMultiSelectMode(sessionId, enabled) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            multiSelectMode: enabled
          }
        }
      };
    });
  },

  enqueueUpload(sessionId, item) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            uploadQueue: [...current.uploadQueue, item]
          }
        }
      };
    });
  },

  updateUpload(sessionId, uploadId, patch) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            uploadQueue: current.uploadQueue.map((item) => (
              item.id === uploadId
                ? {
                  ...item,
                  ...patch,
                  updatedAt: Date.now()
                }
                : item
            ))
          }
        }
      };
    });
  },

  removeUpload(sessionId, uploadId) {
    set((state) => {
      const current = withSessionState(state, sessionId);
      return {
        bySessionId: {
          ...state.bySessionId,
          [sessionId]: {
            ...current,
            uploadQueue: current.uploadQueue.filter((item) => item.id !== uploadId)
          }
        }
      };
    });
  }
}));
