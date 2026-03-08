import { useEffect, useState } from "react";
import type { TerminalPaneHandle } from "../../features/terminal/TerminalPane";

export interface UseMobileScrollOptions {
  isMobile: boolean;
  activeTabId: string | null;
  terminalHandleMapRef: React.RefObject<Map<string, TerminalPaneHandle>>;
}

export interface UseMobileScrollReturn {
  showScrollBottomFab: boolean;
  mobileShortcutsExpanded: boolean;
  setMobileShortcutsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useMobileScroll({
  isMobile,
  activeTabId,
  terminalHandleMapRef
}: UseMobileScrollOptions): UseMobileScrollReturn {
  const [showScrollBottomFab, setShowScrollBottomFab] = useState(false);
  const [mobileShortcutsExpanded, setMobileShortcutsExpanded] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (!isMobile) {
      root.style.setProperty("--mobile-shortcut-bar-offset", "0px");
      return;
    }
    root.style.setProperty("--mobile-shortcut-bar-offset", mobileShortcutsExpanded ? "72px" : "42px");
  }, [isMobile, mobileShortcutsExpanded]);

  useEffect(() => {
    if (!isMobile || !activeTabId) {
      setShowScrollBottomFab(false);
      return;
    }

    const updateVisibility = () => {
      const handle = terminalHandleMapRef.current?.get(activeTabId);
      if (!handle) {
        setShowScrollBottomFab(false);
        return;
      }
      setShowScrollBottomFab(!handle.isNearBottom());
    };

    updateVisibility();
    const timer = window.setInterval(updateVisibility, 150);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeTabId, isMobile, terminalHandleMapRef]);

  return { showScrollBottomFab, mobileShortcutsExpanded, setMobileShortcutsExpanded };
}
