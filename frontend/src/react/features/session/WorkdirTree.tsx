import type { WheelEventHandler } from "react";
import type { WorkdirBrowseResponse, WorkdirEntry } from "../../shared/api/types";

export const ROOT_WORKDIR_LOADING_KEY = "__root__";

export interface VisibleWorkdirEntry {
  depth: number;
  entry: WorkdirEntry;
}

interface WorkdirTreeProps {
  workdirTree: WorkdirBrowseResponse | null;
  workdirLoading: boolean;
  workdirError: string;
  workdirLoadingMap: Record<string, boolean>;
  workdirExpandedMap: Record<string, boolean>;
  visibleWorkdirEntries: VisibleWorkdirEntry[];
  workdir: string;
  onWheel: WheelEventHandler<HTMLDivElement>;
  onSelectRootWorkdir: () => void | Promise<void>;
  onSelectWorkdirEntry: (entry: WorkdirEntry) => void | Promise<void>;
}

export function WorkdirTree({
  workdirTree,
  workdirLoading,
  workdirError,
  workdirLoadingMap,
  workdirExpandedMap,
  visibleWorkdirEntries,
  workdir,
  onWheel,
  onSelectRootWorkdir,
  onSelectWorkdirEntry
}: WorkdirTreeProps): JSX.Element {
  return (
    <section className="advanced-section">
      <label className="field-label" htmlFor="new-session-workdir-tree">Workdir</label>

      <div id="new-session-workdir-tree" className="workdir-tree" role="tree" onWheel={onWheel}>
        {!workdirTree && workdirLoading && <div className="tree-status">Loading workdir...</div>}
        {!workdirTree && !workdirLoading && !workdirError && <div className="tree-status">No directory data</div>}
        {workdirError && <div className="tree-status error">{workdirError}</div>}

        {workdirTree && (
          <div className="tree-list">
            <button
              type="button"
              className={`tree-label tree-root ${workdir === workdirTree.rootPath ? "selected" : ""}`}
              title={workdirTree.rootPath}
              onClick={() => void onSelectRootWorkdir()}
            >
              <span className="tree-prefix">/</span>
              <span className="tree-name">{workdirTree.rootPath}</span>
            </button>

            {(workdirLoadingMap[ROOT_WORKDIR_LOADING_KEY] || workdirLoadingMap[workdirTree.rootPath]) && (
              <div className="tree-status tree-status-indented">Loading...</div>
            )}

            {visibleWorkdirEntries.length === 0 && !workdirLoading && !workdirError ? (
              <div className="tree-status tree-status-indented">No directories</div>
            ) : (
              visibleWorkdirEntries.map((row) => (
                <div key={row.entry.path}>
                  <button
                    type="button"
                    className={`tree-label ${workdir === row.entry.path ? "selected" : ""}`}
                    title={row.entry.path}
                    style={{ paddingInlineStart: `${8 + (row.depth + 1) * 16}px` }}
                    onClick={() => void onSelectWorkdirEntry(row.entry)}
                  >
                    <span className="tree-prefix">
                      {row.entry.hasChildren ? (workdirExpandedMap[row.entry.path] ? "v" : ">") : "-"}
                    </span>
                    <span className="tree-name">{row.entry.name}</span>
                  </button>
                  {workdirLoadingMap[row.entry.path] && (
                    <div
                      className="tree-status tree-status-indented"
                      style={{ paddingInlineStart: `${24 + (row.depth + 1) * 16}px` }}
                    >
                      Loading...
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="selected-workdir">Selected: <code>{workdir || "-"}</code></div>
    </section>
  );
}
