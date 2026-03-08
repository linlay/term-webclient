import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemeMode,
  initializeThemeMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveThemeMode
} from "../react/shared/theme/theme";

describe("theme", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        }
      }
    });
  });

  afterEach(() => {
    storage.clear();
    delete document.body.dataset.theme;
    vi.unstubAllGlobals();
  });

  it("falls back to dark theme when nothing is stored", () => {
    expect(readStoredThemeMode()).toBeNull();
    expect(resolveThemeMode()).toBe("dark");

    const themeMode = initializeThemeMode();
    expect(themeMode).toBe("dark");
    expect(document.body.dataset.theme).toBe("dark");
  });

  it("reads, persists, and applies a stored light theme", () => {
    persistThemeMode("light");

    expect(readStoredThemeMode()).toBe("light");
    expect(resolveThemeMode()).toBe("light");

    applyThemeMode("light");
    expect(document.body.dataset.theme).toBe("light");
  });
});
