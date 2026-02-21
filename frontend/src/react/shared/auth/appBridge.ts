import { isAppMode } from "../config/env";
import { generateId } from "../utils/id";

const TOKEN_EVENT = "appterm:token";
const REFRESH_REQUEST_EVENT = "appterm:refresh-token-requested";
const TOKEN_MESSAGE_TYPE = "appterm:token";
const REFRESH_MESSAGE_TYPE = "appterm:refresh-token";

let initialized = false;
let accessToken: string | null = null;
const listeners = new Set<(token: string | null) => void>();
const pendingRefreshResolvers = new Map<string, (token: string | null) => void>();

export type AppTokenRefreshReason = "missing" | "expired" | "unauthorized";

interface BridgeTokenPayload {
  type?: string;
  accessToken?: string;
  requestId?: string;
  expiresAt?: string | number;
}

declare global {
  interface Window {
    __APPTERM_ACCESS_TOKEN__?: string;
    ReactNativeWebView?: {
      postMessage?: (message: string) => void;
    };
  }
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const token = value.trim();
  return token.length > 0 ? token : null;
}

function notifyTokenChanged(): void {
  listeners.forEach((listener) => {
    listener(accessToken);
  });
}

function setTokenInternal(token: string | null): void {
  if (accessToken === token) {
    return;
  }
  accessToken = token;
  if (token) {
    window.__APPTERM_ACCESS_TOKEN__ = token;
  }
  notifyTokenChanged();
}

function resolvePendingRefresh(requestId: string | undefined, token: string | null): void {
  if (!requestId) {
    return;
  }
  const resolve = pendingRefreshResolvers.get(requestId);
  if (!resolve) {
    return;
  }
  pendingRefreshResolvers.delete(requestId);
  resolve(token);
}

function handleTokenPayload(payload: BridgeTokenPayload | null | undefined): void {
  if (!payload) {
    return;
  }
  const token = normalizeToken(payload.accessToken);
  setTokenInternal(token);
  resolvePendingRefresh(payload.requestId, token);
}

function handleTokenEvent(event: Event): void {
  const customEvent = event as CustomEvent<{ accessToken?: string; requestId?: string }>;
  handleTokenPayload({
    type: TOKEN_MESSAGE_TYPE,
    accessToken: customEvent.detail?.accessToken,
    requestId: customEvent.detail?.requestId
  });
}

function parseMessagePayload(data: unknown): BridgeTokenPayload | null {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as BridgeTokenPayload;
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object") {
    return data as BridgeTokenPayload;
  }
  return null;
}

function handleWindowMessage(event: MessageEvent): void {
  const payload = parseMessagePayload(event.data);
  if (!payload || payload.type !== TOKEN_MESSAGE_TYPE) {
    return;
  }
  handleTokenPayload(payload);
}

function readWindowToken(): string | null {
  return normalizeToken(window.__APPTERM_ACCESS_TOKEN__);
}

export function initAppTokenBridge(): void {
  if (initialized || !isAppMode()) {
    return;
  }
  initialized = true;
  setTokenInternal(readWindowToken());
  window.addEventListener(TOKEN_EVENT, handleTokenEvent as EventListener);
  window.addEventListener("message", handleWindowMessage);
}

export function getAppAccessToken(): string | null {
  if (!isAppMode()) {
    return null;
  }
  initAppTokenBridge();
  if (accessToken) {
    return accessToken;
  }
  const token = readWindowToken();
  if (token) {
    setTokenInternal(token);
  }
  return token;
}

export function subscribeAppAccessToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestAppTokenRefresh(reason: AppTokenRefreshReason): void {
  if (!isAppMode()) {
    return;
  }
  initAppTokenBridge();
  const payload = JSON.stringify({
    type: REFRESH_MESSAGE_TYPE,
    reason
  });
  if (window.ReactNativeWebView?.postMessage) {
    window.ReactNativeWebView.postMessage(payload);
  }
  window.dispatchEvent(new CustomEvent(REFRESH_REQUEST_EVENT, { detail: { reason } }));
}

export function refreshAppAccessToken(reason: AppTokenRefreshReason, timeoutMs = 8000): Promise<string | null> {
  if (!isAppMode()) {
    return Promise.resolve(null);
  }
  initAppTokenBridge();

  const requestId = generateId();
  const currentToken = getAppAccessToken();
  const payload = JSON.stringify({
    type: REFRESH_MESSAGE_TYPE,
    reason,
    requestId
  });

  const promise = new Promise<string | null>((resolve) => {
    const timeout = window.setTimeout(() => {
      pendingRefreshResolvers.delete(requestId);
      resolve(getAppAccessToken());
    }, Math.max(500, timeoutMs));

    pendingRefreshResolvers.set(requestId, (token) => {
      window.clearTimeout(timeout);
      resolve(token);
    });
  });

  if (window.ReactNativeWebView?.postMessage) {
    window.ReactNativeWebView.postMessage(payload);
  }
  window.dispatchEvent(new CustomEvent(REFRESH_REQUEST_EVENT, { detail: { reason, requestId } }));

  return promise.then((token) => {
    if (token && token !== currentToken) {
      return token;
    }
    return getAppAccessToken();
  });
}
