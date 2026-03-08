const rawApiBase = typeof import.meta.env.VITE_API_BASE === "string"
  ? import.meta.env.VITE_API_BASE.trim()
  : "";
const rawCopilotRefreshMs = Number.parseInt(import.meta.env.VITE_COPILOT_REFRESH_MS || "2000", 10);

export const API_BASE = rawApiBase.replace(/\/+$/, "");
export const COPILOT_REFRESH_MS = Number.isFinite(rawCopilotRefreshMs) && rawCopilotRefreshMs >= 500
  ? rawCopilotRefreshMs
  : 2000;

export function isAppMode(pathname: string = window.location.pathname): boolean {
  return pathname === "/appterm" || pathname.startsWith("/appterm/");
}

export function uiBasePath(pathname: string = window.location.pathname): "/term" | "/appterm" {
  return isAppMode(pathname) ? "/appterm" : "/term";
}

export function apiPrefix(pathname: string = window.location.pathname): "/term/api" | "/appterm/api" {
  return isAppMode(pathname) ? "/appterm/api" : "/term/api";
}

export function apiPath(path: string, pathname: string = window.location.pathname): string {
  if (
    path.startsWith("/term/api/")
    || path.startsWith("/appterm/api/")
    || path === "/term/api"
    || path === "/appterm/api"
  ) {
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

export function wsPrefix(pathname: string = window.location.pathname): "/term/ws" | "/appterm/ws" {
  return isAppMode(pathname) ? "/appterm/ws" : "/term/ws";
}

function wsPath(path: string, pathname: string = window.location.pathname): string {
  if (
    path.startsWith("/term/ws/")
    || path.startsWith("/appterm/ws/")
    || path === "/term/ws"
    || path === "/appterm/ws"
  ) {
    return path;
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  const [pathPart, query = ""] = normalized.split("?", 2);
  const suffix = query ? `?${query}` : "";
  if (pathPart === "/ws" || pathPart.startsWith("/ws/")) {
    return `${wsPrefix(pathname)}${pathPart.slice("/ws".length)}${suffix}`;
  }
  return `${wsPrefix(pathname)}${pathPart}${suffix}`;
}

export function toWsUrl(path: string, pathname: string = window.location.pathname): string {
  if (path.startsWith("ws://") || path.startsWith("wss://")) {
    return path;
  }
  return `${wsBaseFromApiBase()}${wsPath(path, pathname)}`;
}
