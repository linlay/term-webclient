const rawApiBase = typeof import.meta.env.VITE_API_BASE === "string"
  ? import.meta.env.VITE_API_BASE.trim()
  : "";

export const API_BASE = rawApiBase.replace(/\/+$/, "");

export function isAppMode(pathname: string = window.location.pathname): boolean {
  return pathname === "/appterm" || pathname.startsWith("/appterm/");
}

export function uiBasePath(pathname: string = window.location.pathname): "/term" | "/appterm" {
  return isAppMode(pathname) ? "/appterm" : "/term";
}

export function apiPrefix(pathname: string = window.location.pathname): "/webapi" | "/appapi" {
  return isAppMode(pathname) ? "/appapi" : "/webapi";
}

export function apiPath(path: string, pathname: string = window.location.pathname): string {
  if (path.startsWith("/webapi/") || path.startsWith("/appapi/") || path === "/webapi" || path === "/appapi") {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiPrefix(pathname)}${normalized}`;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${apiPath(path)}`;
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
