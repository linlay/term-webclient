import { useEffect } from "react";

export function useViewportHeight(): void {
  useEffect(() => {
    const root = document.documentElement;
    let settleTimer: number | null = null;
    let longSettleTimer: number | null = null;
    const updateViewportVars = (useSafeMax = false) => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport ? Math.max(0, viewport.height) : window.innerHeight;
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      const keyboardInset = viewport ? Math.max(0, layoutHeight - viewportHeight - viewport.offsetTop) : 0;

      const effectiveHeight = useSafeMax && keyboardInset < 10
        ? Math.max(viewportHeight, window.innerHeight)
        : viewportHeight;

      root.style.setProperty("--app-vh", `${Math.round(effectiveHeight)}px`);
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
