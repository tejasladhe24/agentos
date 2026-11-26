import { afterEach, describe, expect, test } from 'bun:test';

import { claim, eventsServiceHeaders, publish } from '@agentos/core/api/events';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureHeaders(): { seen: Headers[] } {
  const state = { seen: [] as Headers[] };
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    state.seen.push(new Headers(init?.headers));
    return Response.json({ ok: true, messages: [] });
  }) as unknown as typeof fetch;
  return state;
}

const env = {
  AGENT_OS_EVENTS_API_BASE: 'http://events.test',
  AGENT_OS_EVENTS_SERVICE_TOKEN: 'tok-123',
};

describe('events client service auth', () => {
  test('eventsServiceHeaders builds bearer + optional org header', () => {
    expect(eventsServiceHeaders(env)).toEqual({
      authorization: 'Bearer tok-123',
    });
    expect(eventsServiceHeaders(env, 'org-a')).toEqual({
      authorization: 'Bearer tok-123',
      'x-agentos-org-id': 'org-a',
    });
    expect(eventsServiceHeaders({})).toEqual({});
  });

  test('publish and claim send the service token; publish forwards orgId', async () => {
    const state = captureHeaders();
    await publish('demo', { a: 1 }, env, { orgId: 'org-a' });
    await claim(1, env);
    expect(state.seen[0]?.get('authorization')).toBe('Bearer tok-123');
    expect(state.seen[0]?.get('x-agentos-org-id')).toBe('org-a');
    expect(state.seen[1]?.get('authorization')).toBe('Bearer tok-123');
    expect(state.seen[1]?.get('x-agentos-org-id')).toBeNull();
  });
});
