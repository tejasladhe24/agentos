import { afterEach, describe, expect, test } from 'bun:test';

import { createApp } from '@agentos/core/api';
import {
  getPublicAccess,
  isPublicApiPath,
  requirePublicToken,
  resolvePublicTokenRole,
  signPublicToken,
  verifyPublicToken,
} from '@agentos/core/api/public-token';
import type { AuthSession } from '@agentos/core/api/auth';

const SECRET = 'test-public-link-secret-32chars!!';

const ADMIN_SESSION: AuthSession = {
  user: { id: 'u-admin', email: 'admin@example.com', name: 'Admin' },
  session: { id: 's-admin', expiresAt: '2099-01-01T00:00:00.000Z' },
  roles: ['admin'],
  orgId: 'org-1',
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
};

const originalFetch = globalThis.fetch;
const originalAuthBase = Bun.env.AGENT_OS_AUTH_API_BASE;
const originalSecret = Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAuthBase === undefined) {
    delete Bun.env.AGENT_OS_AUTH_API_BASE;
  } else {
    Bun.env.AGENT_OS_AUTH_API_BASE = originalAuthBase;
  }
  if (originalSecret === undefined) {
    delete Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET;
  } else {
    Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET = originalSecret;
  }
});

describe('public token', () => {
  test('sign + verify round-trip', async () => {
    const token = await signPublicToken({
      orgId: 'org-1',
      extensionId: 'demo',
      purpose: 'portal',
      ttlSeconds: 60,
      pathPrefix: '/portal/',
      secret: SECRET,
    });
    const payload = await verifyPublicToken(token, { secret: SECRET });
    expect(payload).toMatchObject({
      orgId: 'org-1',
      extensionId: 'demo',
      purpose: 'portal',
      pathPrefix: '/portal/',
      role: 'external_viewer',
    });
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(resolvePublicTokenRole(payload!)).toBe('external_viewer');
  });

  test('explicit role overrides purpose default', async () => {
    const token = await signPublicToken({
      orgId: 'org-1',
      extensionId: 'demo',
      purpose: 'portal',
      role: 'sales',
      ttlSeconds: 60,
      secret: SECRET,
    });
    const payload = await verifyPublicToken(token, { secret: SECRET });
    expect(payload?.role).toBe('sales');
    expect(resolvePublicTokenRole(payload!)).toBe('sales');
  });

  test('rejects expired and tampered tokens', async () => {
    const token = await signPublicToken({
      orgId: 'org-1',
      extensionId: 'demo',
      purpose: 'portal',
      ttlSeconds: 60,
      secret: SECRET,
    });
    const expired = await verifyPublicToken(token, {
      secret: SECRET,
      nowSeconds: Math.floor(Date.now() / 1000) + 120,
    });
    expect(expired).toBeNull();

    const [body] = token.split('.');
    const bad = `${body}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    expect(await verifyPublicToken(bad, { secret: SECRET })).toBeNull();
  });

  test('isPublicApiPath prefix matching', () => {
    expect(isPublicApiPath('/portal', ['/portal/'])).toBe(true);
    expect(isPublicApiPath('/portal/status', ['/portal/'])).toBe(true);
    expect(isPublicApiPath('/private', ['/portal/'])).toBe(false);
    expect(isPublicApiPath('/portalish', ['/portal/'])).toBe(false);
  });

  test('requirePublicToken accepts Bearer and query token', async () => {
    const token = await signPublicToken({
      orgId: 'org-9',
      extensionId: 'demo',
      purpose: 'portal',
      secret: SECRET,
    });

    const app = createApp();
    app.route(
      'GET',
      '/portal/status',
      (c) => c.json({ access: getPublicAccess(c) }),
      [requirePublicToken({ secret: SECRET })],
    );

    const bearer = await app.fetch(
      new Request('http://localhost/portal/status', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(bearer.status).toBe(200);
    expect(await bearer.json()).toMatchObject({
      access: { orgId: 'org-9', purpose: 'portal' },
    });

    const query = await app.fetch(
      new Request(`http://localhost/portal/status?token=${token}`),
    );
    expect(query.status).toBe(200);

    const missing = await app.fetch(
      new Request('http://localhost/portal/status'),
    );
    expect(missing.status).toBe(401);
  });

  test('createApp publicApiPrefixes default-deny', async () => {
    Bun.env.AGENT_OS_AUTH_API_BASE = 'http://auth.test';
    Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET = SECRET;

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const headers = new Headers(init?.headers);
      if (typeof input !== 'string' && !(input instanceof URL)) {
        for (const [k, v] of input.headers) {
          if (!headers.has(k)) headers.set(k, v);
        }
      }
      const cookie = headers.get('cookie') ?? '';
      if (url.endsWith('/session')) {
        if (cookie.includes('sid=ok')) {
          return Response.json(ADMIN_SESSION);
        }
        return Response.json({ error: 'unauthenticated' }, { status: 401 });
      }
      return new Response('not mocked', { status: 500 });
    }) as typeof fetch;

    const token = await signPublicToken({
      orgId: 'org-1',
      extensionId: 'demo',
      purpose: 'portal',
      pathPrefix: '/portal/',
      secret: SECRET,
    });

    const app = createApp({
      publicApiPrefixes: ['/portal/'],
      openApiPrefixes: ['/webhooks/', '/oauth/callback'],
    });
    app.route('GET', '/portal/status', (c) =>
      c.json({ ok: true, orgId: getPublicAccess(c)?.orgId }),
    );
    app.route('GET', '/private', (c) => c.json({ ok: true }));
    app.route('POST', '/webhooks/inbound', (c) => c.json({ open: true }));
    app.route('GET', '/oauth/callback', (c) => c.json({ open: true }));

    const health = await app.fetch(new Request('http://localhost/health'));
    expect(health.status).toBe(200);

    const publicOk = await app.fetch(
      new Request('http://localhost/portal/status', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(publicOk.status).toBe(200);
    expect(await publicOk.json()).toEqual({ ok: true, orgId: 'org-1' });

    const publicNoToken = await app.fetch(
      new Request('http://localhost/portal/status'),
    );
    expect(publicNoToken.status).toBe(401);

    const privateNoCookie = await app.fetch(
      new Request('http://localhost/private'),
    );
    expect(privateNoCookie.status).toBe(401);

    const privateOk = await app.fetch(
      new Request('http://localhost/private', {
        headers: { cookie: 'sid=ok' },
      }),
    );
    expect(privateOk.status).toBe(200);

    const webhookOpen = await app.fetch(
      new Request('http://localhost/webhooks/inbound', { method: 'POST' }),
    );
    expect(webhookOpen.status).toBe(200);
    expect(await webhookOpen.json()).toEqual({ open: true });

    const oauthOpen = await app.fetch(
      new Request('http://localhost/oauth/callback'),
    );
    expect(oauthOpen.status).toBe(200);
  });
});
