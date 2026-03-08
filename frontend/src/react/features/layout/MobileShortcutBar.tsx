import type { SessionType } from "../../shared/api/types";

interface ShortcutItem {
  label: string;
  seq?: string;
  action?: "collapse" | "paste";
}

const MOBILE_SHORTCUTS_TERMINAL_SSH: ShortcutItem[] = [
  { label: "ESC", seq: "\u001b" },
  { label: "HOME", seq: "\u001b[H" },
  { label: "END", seq: "\u001b[F" },
  { label: "PG UP", seq: "\u001b[5~" },
  { label: "PG DOWN", seq: "\u001b[6~" },
  { label: "↑", seq: "\u001b[A" },
  { label: "收起", action: "collapse" },
  { label: "TAB", seq: "\t" },
  { label: "CTRL+C", seq: "\u0003" },
  { label: "粘贴", action: "paste" },
  { label: "回车", seq: "\r" },
  { label: "←", seq: "\u001b[D" },
  { label: "↓", seq: "\u001b[B" },
  { label: "→", seq: "\u001b[C" }
];

const MOBILE_SHORTCUTS_CODEX_CLAUDE: ShortcutItem[] = [
  { label: "ESC", seq: "\u001b" },
  { label: "1", seq: "1" },
  { label: "2", seq: "2" },
  { label: "3", seq: "3" },
  { label: "4", seq: "4" },
  { label: "↑", seq: "\u001b[A" },
  { label: "收起", action: "collapse" },
  { label: "TAB", seq: "\t" },
  { label: "PLAN模式", seq: "\u001b[Z" },
  { label: "粘贴", action: "paste" },
  { label: "回车", seq: "\r" },
  { label: "←", seq: "\u001b[D" },
  { label: "↓", seq: "\u001b[B" },
  { label: "→", seq: "\u001b[C" }
];

export function resolveMobileShortcuts(sessionType: SessionType | null, toolId: string | null): ShortcutItem[] {
  const normalizedToolId = (toolId || "").trim().toLowerCase();
  if (sessionType === "SSH_SHELL" || normalizedToolId === "ssh" || normalizedToolId === "terminal") {
    return MOBILE_SHORTCUTS_TERMINAL_SSH;
  }
  if (normalizedToolId === "codex" || normalizedToolId === "claude") {
    return MOBILE_SHORTCUTS_CODEX_CLAUDE;
  }
  return MOBILE_SHORTCUTS_TERMINAL_SSH;
}

interface MobileShortcutBarProps {
  sessionType: SessionType | null;
  toolId: string | null;
  expanded: boolean;
  onToggle: () => void;
  onSend: (sequence: string) => void;
  onPaste: () => void;
  onCollapse: () => void;
}

export function MobileShortcutBar({
  sessionType,
  toolId,
  expanded,
  onToggle,
  onSend,
  onPaste,
  onCollapse
}: MobileShortcutBarProps): JSX.Element {
  const shortcuts = resolveMobileShortcuts(sessionType, toolId);

  return (
    <div className={`mobile-shortcut-bar ${expanded ? "expanded" : "collapsed"}`} aria-label="终端虚拟键盘">
      <button
        type="button"
        className="mobile-shortcut-toggle"
        aria-expanded={expanded}
        aria-controls="mobileShortcutKeys"
        onClick={onToggle}
      >
        虚拟键盘
      </button>
      <div id="mobileShortcutKeys" className="mobile-shortcut-keys" role="group" aria-label="终端虚拟按键">
        {shortcuts.map((shortcut) => (
          <button
            key={`${shortcut.label}-${shortcut.seq || shortcut.action || "none"}`}
            type="button"
            className="mobile-shortcut-key"
            onClick={() => {
              if (shortcut.action === "collapse") {
                onCollapse();
                return;
              }
              if (shortcut.action === "paste") {
                onPaste();
                return;
              }
              if (shortcut.seq) {
                onSend(shortcut.seq);
              }
            }}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
    </div>
  );
}
