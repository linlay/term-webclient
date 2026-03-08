import { useCallback, useEffect, useRef, useState } from "react";

export interface NoticeState {
  message: string;
  type: "info" | "warn" | "error" | "success";
}

export interface UseNoticeReturn {
  notice: NoticeState | null;
  showNotice: (message: string, type?: NoticeState["type"], timeoutMs?: number) => void;
}

export function useNotice(): UseNoticeReturn {
  const timerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const showNotice = useCallback((message: string, type: NoticeState["type"] = "info", timeoutMs = 2600): void => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setNotice({ message, type });
    timerRef.current = window.setTimeout(() => {
      setNotice(null);
      timerRef.current = null;
    }, timeoutMs);
  }, []);

  return { notice, showNotice };
}
