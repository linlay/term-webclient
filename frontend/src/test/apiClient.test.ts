import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "../react/shared/api/client";

describe("apiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, authenticated: true, username: "admin" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(apiClient.getAuthStatus()).resolves.toMatchObject({
      enabled: true,
      authenticated: true,
      username: "admin"
    });
  });

  it("throws ApiError for non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(apiClient.getAuthStatus()).rejects.toBeInstanceOf(ApiError);
  });
});
