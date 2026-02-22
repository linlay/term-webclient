import { useEffect } from "react";

function getViewportMetrics(): { viewportHeight: number; viewportTop: number; keyboardInset: number } {
  const viewport = window.visualViewport;
  if (!viewport) {
    return {
      viewportHeight: Math.max(0, window.innerHeight),
      viewportTop: 0,
      keyboardInset: 0
    };
  }

  const viewportHeight = Math.max(0, viewport.height);
  const viewportTop = Math.max(0, viewport.offsetTop);
  const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
  const keyboardInset = Math.max(0, layoutHeight - viewportHeight - viewportTop);

  return { viewportHeight, viewportTop, keyboardInset };
}

export function useViewportHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    let settleTimer: number | null = null;
    let longSettleTimer: number | null = null;
    const updateViewportVars = (useSafeMax = false) => {
      const { viewportHeight, viewportTop, keyboardInset } = getViewportMetrics();
      const safeMaxEnabled = useSafeMax && keyboardInset < 10;

      const effectiveHeight = safeMaxEnabled
        ? Math.max(viewportHeight, Math.max(0, window.innerHeight))
        : viewportHeight;
      const effectiveTop = safeMaxEnabled ? 0 : viewportTop;

      root.style.setProperty("--app-vh", `${Math.round(effectiveHeight)}px`);
      root.style.setProperty("--app-vtop", `${Math.round(effectiveTop)}px`);
      root.style.setProperty("--mobile-shortcut-inset", `${Math.round(keyboardInset)}px`);
    };
    const scheduleSettledViewportUpdate = () => {
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
      }
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        updateViewportVars();
      }, 150);
    };
    const handleViewportChange = () => {
      updateViewportVars();
      scheduleSettledViewportUpdate();
    };
    const handleFocusOut = () => {
      scheduleSettledViewportUpdate();
      if (longSettleTimer != null) {
        window.clearTimeout(longSettleTimer);
      }
      longSettleTimer = window.setTimeout(() => {
        longSettleTimer = null;
        updateViewportVars(true);
      }, 400);
    };

    updateViewportVars();

    const viewport = window.visualViewport;
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.addEventListener("pageshow", handleViewportChange);
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);
    document.addEventListener("focusin", scheduleSettledViewportUpdate, true);
    document.addEventListener("focusout", handleFocusOut, true);

    return () => {
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
      }
      if (longSettleTimer != null) {
        window.clearTimeout(longSettleTimer);
      }
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.removeEventListener("pageshow", handleViewportChange);
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      document.removeEventListener("focusin", scheduleSettledViewportUpdate, true);
      document.removeEventListener("focusout", handleFocusOut, true);
    };
  }, []);
}
