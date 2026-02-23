import { describe, expect, it } from 'vitest';
import {
  buildRouteSearch,
  parseRouteIntent,
  shouldSyncRouteSessionFromActive
} from '../react/shared/routing/routeIntent';

describe('routeIntent', () => {
  it('parses session selection and open-new-session intent', () => {
    expect(parseRouteIntent('?sessionId=s-1&openNewSession=1&openNonce=42')).toEqual({
      sessionId: 's-1',
      openNewSession: true,
      openNonce: '42'
    });
  });

  it('treats missing query fields as empty/false values', () => {
    expect(parseRouteIntent('?sessionId=s-2&openNewSession=1')).toEqual({
      sessionId: 's-2',
      openNewSession: true,
      openNonce: ''
    });
  });

  it('buildRouteSearch removes open intent fields while preserving sessionId', () => {
    expect(
      buildRouteSearch('?sessionId=s-1&openNewSession=1&openNonce=abc&foo=bar', {
        openNewSession: null,
        openNonce: null
      })
    ).toBe('?sessionId=s-1&foo=bar');
  });

  it('buildRouteSearch updates sessionId and keeps unrelated query fields', () => {
    expect(
      buildRouteSearch('?foo=bar&openNewSession=1', {
        sessionId: 's-9',
        openNewSession: false
      })
    ).toBe('?foo=bar&sessionId=s-9');
  });

  it('treats explicit disabled openNewSession as false', () => {
    expect(parseRouteIntent('?openNewSession=0')).toEqual({
      sessionId: '',
      openNewSession: false,
      openNonce: ''
    });
  });

  it('scenario A: does not override URL when route session still exists', () => {
    expect(
      shouldSyncRouteSessionFromActive(
        'session-active',
        'session-route',
        ['session-route', 'session-active']
      )
    ).toBe(false);
  });

  it('scenario B: repairs URL when route session no longer exists', () => {
    expect(
      shouldSyncRouteSessionFromActive(
        'session-active',
        'session-missing',
        ['session-active', 'session-other']
      )
    ).toBe(true);
  });

  it('scenario C: user tab selection updates sessionId and reaches stable state', () => {
    expect(
      buildRouteSearch('?sessionId=session-old&foo=bar', { sessionId: 'session-new' })
    ).toBe('?sessionId=session-new&foo=bar');
    expect(
      shouldSyncRouteSessionFromActive(
        'session-new',
        'session-new',
        ['session-new', 'session-other']
      )
    ).toBe(false);
  });
});
