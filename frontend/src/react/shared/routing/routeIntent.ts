export interface RouteIntent {
  sessionId: string;
  openNewSession: boolean;
  openNonce: string;
}

const OPEN_NEW_SESSION_NONCE_PREFIX = 'appterm.open-new-session.';

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

export function consumeOpenNewSessionNonce(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  openNonce: string
): boolean {
  const normalizedNonce = normalizeString(openNonce);
  if (!normalizedNonce) {
    return false;
  }

  const storageKey = `${OPEN_NEW_SESSION_NONCE_PREFIX}${normalizedNonce}`;

  try {
    if (storage.getItem(storageKey) === '1') {
      return false;
    }
    storage.setItem(storageKey, '1');
    return true;
  } catch {
    return true;
  }
}
