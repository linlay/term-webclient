const rawApiBase = typeof import.meta.env.VITE_API_BASE === "string"
  ? import.meta.env.VITE_API_BASE.trim()
  : "";

export const API_BASE = rawApiBase.replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function wsBaseFromApiBase(): string {
  if (!API_BASE) {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${window.location.host}`;
  }

  const parsed = new URL(API_BASE, window.location.origin);
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${parsed.host}`;
}

export function toWsUrl(path: string): string {
  if (path.startsWith("ws://") || path.startsWith("wss://")) {
    return path;
  }
  return `${wsBaseFromApiBase()}${path}`;
}
