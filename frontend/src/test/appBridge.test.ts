import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadBridge(): Promise<typeof import("../react/shared/auth/appBridge")> {
  vi.resetModules();
  return import("../react/shared/auth/appBridge");
}

describe("appBridge", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/appterm/");
    delete (window as Window & { __APPTERM_ACCESS_TOKEN__?: string }).__APPTERM_ACCESS_TOKEN__;
    delete (
      window as Window & {
        ReactNativeWebView?: {
          postMessage?: (message: string) => void;
        };
      }
    ).ReactNativeWebView;
  });

  it("accepts auth_token message and updates access token", async () => {
    const bridge = await loadBridge();
    bridge.initAppTokenBridge();

    window.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({
        type: "auth_token",
        accessToken: "token-msg-1"
      })
    }));

    expect(bridge.getAppAccessToken()).toBe("token-msg-1");
  });

  it("sends auth_refresh_request with requestId/source/reason and resolves on auth_refresh_result success", async () => {
    const bridge = await loadBridge();
    const postMessage = vi.fn();
    (
      window as Window & {
        ReactNativeWebView?: {
          postMessage?: (message: string) => void;
        };
      }
    ).ReactNativeWebView = { postMessage };

    const promise = bridge.refreshAppAccessToken("missing", 1000);
    expect(postMessage).toHaveBeenCalledTimes(1);

    const request = JSON.parse(String(postMessage.mock.calls[0]?.[0] || "{}")) as Record<string, unknown>;
    expect(request.type).toBe("auth_refresh_request");
    expect(typeof request.requestId).toBe("string");
    expect(request.source).toBe("appterm");
    expect(request.reason).toBe("missing");

    window.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({
        type: "auth_refresh_result",
        requestId: request.requestId,
        ok: true,
        accessToken: "token-msg-2"
      })
    }));

    await expect(promise).resolves.toBe("token-msg-2");
    expect(bridge.getAppAccessToken()).toBe("token-msg-2");
  });

  it("resolves refresh promise with null when auth_refresh_result is failed", async () => {
    const bridge = await loadBridge();
    const postMessage = vi.fn();
    (
      window as Window & {
        ReactNativeWebView?: {
          postMessage?: (message: string) => void;
        };
      }
    ).ReactNativeWebView = { postMessage };

    const promise = bridge.refreshAppAccessToken("unauthorized", 1000);
    const request = JSON.parse(String(postMessage.mock.calls[0]?.[0] || "{}")) as Record<string, unknown>;

    window.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({
        type: "auth_refresh_result",
        requestId: request.requestId,
        ok: false,
        error: "refresh failed"
      })
    }));

    await expect(promise).resolves.toBeNull();
  });
});
