export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "term-webclient.theme-mode";

function canUseDOM(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" ? "light" : "dark";
}

export function readStoredThemeMode(): ThemeMode | null {
  if (!canUseDOM()) {
    return null;
  }
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!value) {
      return null;
    }
    return normalizeThemeMode(value);
  } catch {
    return null;
  }
}

export function resolveThemeMode(): ThemeMode {
  return readStoredThemeMode() ?? "dark";
}

export function persistThemeMode(themeMode: ThemeMode): void {
  if (!canUseDOM()) {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function applyThemeMode(themeMode: ThemeMode): void {
  if (!canUseDOM()) {
    return;
  }
  document.body.dataset.theme = themeMode;
}

export function initializeThemeMode(): ThemeMode {
  const themeMode = resolveThemeMode();
  applyThemeMode(themeMode);
  return themeMode;
}
