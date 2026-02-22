import { describe, expect, it } from 'vitest';
import { consumeOpenNewSessionNonce, parseRouteIntent } from '../react/shared/routing/routeIntent';

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem(key: string) {
      return data.has(key) ? String(data.get(key)) : null;
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    }
  };
}

describe('routeIntent', () => {
  it('parses session selection and open-new-session intent', () => {
    expect(parseRouteIntent('?sessionId=s-1&openNewSession=1&openNonce=42')).toEqual({
      sessionId: 's-1',
      openNewSession: true,
      openNonce: '42'
    });
  });

  it('treats missing query fields as empty/false values', () => {
    expect(parseRouteIntent('?openNewSession=0')).toEqual({
      sessionId: '',
      openNewSession: false,
      openNonce: ''
    });
  });

  it('consumes each openNonce once per sessionStorage scope', () => {
    const storage = createMemoryStorage();

    expect(consumeOpenNewSessionNonce(storage, 'abc')).toBe(true);
    expect(consumeOpenNewSessionNonce(storage, 'abc')).toBe(false);
    expect(consumeOpenNewSessionNonce(storage, 'def')).toBe(true);
  });

  it('ignores empty nonce values', () => {
    const storage = createMemoryStorage();
    expect(consumeOpenNewSessionNonce(storage, '')).toBe(false);
  });
});
