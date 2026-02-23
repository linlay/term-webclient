export interface RouteIntent {
  sessionId: string;
  openNewSession: boolean;
  openNonce: string;
}

export interface RouteIntentPatch {
  sessionId?: string | null;
  openNewSession?: boolean | null;
  openNonce?: string | null;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseRouteIntent(search: string): RouteIntent {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const openNewSessionRaw = normalizeString(params.get('openNewSession')).toLowerCase();

  return {
    sessionId: normalizeString(params.get('sessionId')),
    openNewSession: openNewSessionRaw === '1' || openNewSessionRaw === 'true',
    openNonce: normalizeString(params.get('openNonce'))
  };
}

function setStringParam(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (value === undefined) {
    return;
  }
  const normalized = value === null ? '' : normalizeString(value);
  if (!normalized) {
    params.delete(key);
    return;
  }
  params.set(key, normalized);
}

export function buildRouteSearch(currentSearch: string, patch: RouteIntentPatch): string {
  const params = new URLSearchParams(String(currentSearch || '').replace(/^\?/, ''));

  setStringParam(params, 'sessionId', patch.sessionId);
  setStringParam(params, 'openNonce', patch.openNonce);

  if (patch.openNewSession !== undefined) {
    if (patch.openNewSession) {
      params.set('openNewSession', '1');
    } else {
      params.delete('openNewSession');
    }
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function writeRouteSearch(
  patch: RouteIntentPatch,
  mode: 'replace' | 'push' = 'replace'
): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const nextSearch = buildRouteSearch(window.location.search, patch);
  if (nextSearch === window.location.search) {
    return nextSearch;
  }

  const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  try {
    if (mode === 'push') {
      window.history.pushState(null, '', nextUrl);
    } else {
      window.history.replaceState(null, '', nextUrl);
    }
  } catch {
    // Keep UI local state usable even when browser history API is unavailable.
  }

  return nextSearch;
}
