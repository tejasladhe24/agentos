import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createShellHostApi,
  filesBlobUrl,
  resetPermissionCache,
  useShellStore,
} from '@agentos/core/shell/lib';

type Call = { url: string; method: string; body: unknown };

const originalFetch = globalThis.fetch;
let calls: Call[] = [];

function stubFetch(
  handler: (call: Call) => Response | Promise<Response> | never,
): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

const originalRoles = useShellStore.getState().sessionRoles;

beforeEach(() => {
  resetPermissionCache();
  useShellStore.setState({ sessionRoles: ['member'] });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  useShellStore.setState({ sessionRoles: originalRoles });
  resetPermissionCache();
});

describe('host.auth.can', () => {
  test('wraps auth/permissions/check and caches the decision per session', async () => {
    stubFetch(() => Response.json({ allowed: true }));
    const host = createShellHostApi('inbound-email');

    expect(await host.auth.can('email.send')).toBe(true);
    expect(await host.auth.can('email.send')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: '/api/ext/auth/permissions/check',
      method: 'POST',
      body: { permission: 'email.send' },
    });

    // A different permission is a separate lookup.
    await host.auth.can('email.receive');
    expect(calls).toHaveLength(2);
  });

  test('a denied answer is false and cached', async () => {
    stubFetch(() => Response.json({ allowed: false }));
    const host = createShellHostApi('inbound-email');
    expect(await host.auth.can('x.y')).toBe(false);
    expect(await host.auth.can('x.y')).toBe(false);
    expect(calls).toHaveLength(1);
  });

  test('401 means signed out → false', async () => {
    stubFetch(() => new Response('{}', { status: 401 }));
    const host = createShellHostApi('inbound-email');
    expect(await host.auth.can('email.send')).toBe(false);
  });

  test('an unreachable auth service rejects and is not cached', async () => {
    let healthy = false;
    stubFetch(() =>
      healthy
        ? Response.json({ allowed: true })
        : new Response('{"error":"auth down"}', { status: 503 }),
    );
    const host = createShellHostApi('inbound-email');

    await expect(host.auth.can('email.send')).rejects.toThrow('auth down');
    healthy = true;
    expect(await host.auth.can('email.send')).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test('a different session (roles) does not reuse the cache', async () => {
    stubFetch(() => Response.json({ allowed: true }));
    const host = createShellHostApi('inbound-email');
    await host.auth.can('email.send');
    useShellStore.setState({ sessionRoles: ['admin'] });
    await host.auth.can('email.send');
    expect(calls).toHaveLength(2);
  });
});

describe('host.notifications capabilities', () => {
  test('send posts to notify and returns the delivery', async () => {
    stubFetch(() =>
      Response.json({ notification: { id: 'n1', status: 'sent' } }),
    );
    const host = createShellHostApi('inbound-email');
    const delivery = await host.notifications.send({
      channel: 'email',
      to: 'a@b.c',
      message: 'hi',
    });
    expect(delivery).toEqual({ id: 'n1', status: 'sent' });
    expect(calls[0]).toEqual({
      url: '/api/ext/notifications/notify',
      method: 'POST',
      body: { channel: 'email', to: 'a@b.c', message: 'hi' },
    });
  });

  test('send rejects with the server error message', async () => {
    stubFetch(() => new Response('{"error":"no provider"}', { status: 400 }));
    const host = createShellHostApi('inbound-email');
    await expect(host.notifications.send({ channel: 'email' })).rejects.toThrow(
      'no provider',
    );
  });

  test('send rejects on a malformed success body', async () => {
    stubFetch(() => Response.json({ nope: true }));
    const host = createShellHostApi('inbound-email');
    await expect(host.notifications.send({ message: 'x' })).rejects.toThrow(
      /Invalid notification response/,
    );
  });

  test('email preferences read and write the notifications builtin', async () => {
    stubFetch((call) =>
      Response.json(
        call.method === 'PUT'
          ? {
              from: (call.body as { from: string | null }).from,
              orgFrom: 'o@x',
            }
          : { from: null, orgFrom: 'o@x' },
      ),
    );
    const host = createShellHostApi('inbound-email');

    expect(await host.notifications.getEmailPreferences()).toEqual({
      from: null,
      orgFrom: 'o@x',
    });
    expect(await host.notifications.setEmailPreferences('me@x')).toEqual({
      from: 'me@x',
      orgFrom: 'o@x',
    });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', '/api/ext/notifications/preferences/email'],
      ['PUT', '/api/ext/notifications/preferences/email'],
    ]);
    expect(calls[1]!.body).toEqual({ from: 'me@x' });
  });

  test('email preference failures surface the server message', async () => {
    stubFetch(() => new Response('{"error":"bad from"}', { status: 422 }));
    const host = createShellHostApi('inbound-email');
    await expect(host.notifications.setEmailPreferences('x')).rejects.toThrow(
      'bad from',
    );
  });
});

describe('host.files.blobUrl', () => {
  test('builds a same-origin, encoded blob URL without a network call', async () => {
    stubFetch(() => {
      throw new Error('blobUrl must not fetch');
    });
    const host = createShellHostApi('inbound-email');
    expect(await host.files.blobUrl('orgs/a/inbound/1.pdf')).toBe(
      '/api/ext/files/blobs/orgs%2Fa%2Finbound%2F1.pdf',
    );
    expect(filesBlobUrl('a b')).toBe('/api/ext/files/blobs/a%20b');
    expect(calls).toEqual([]);
  });
});
