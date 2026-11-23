import { afterEach, describe, expect, test } from 'bun:test';

import { createApp } from '@agentos/core/api';
import {
  getSession,
  requireOrg,
  requirePermissions,
  requireRoles,
  requireSession,
  resolveAuthApiBase,
  type AuthSession,
} from '@agentos/core/api/auth';

const ADMIN_SESSION: AuthSession = {
  user: { id: 'u-admin', email: 'admin@example.com', name: 'Admin' },
  session: { id: 's-admin', expiresAt: '2099-01-01T00:00:00.000Z' },
  roles: ['admin'],
  orgId: 'org-1',
  orgs: [{ id: 'org-1', name: 'Acme', role: 'owner' }],
};

const VIEWER_SESSION: AuthSession = {
  user: { id: 'u-viewer', email: 'viewer@example.com', name: 'Viewer' },
  session: { id: 's-viewer', expiresAt: '2099-01-01T00:00:00.000Z' },
  roles: ['viewer'],
  orgId: 'org-1',
  orgs: [{ id: 'org-1', name: 'Acme', role: 'member' }],
};

const NO_ORG_SESSION: AuthSession = {
  user: { id: 'u-lonely', email: 'lonely@example.com', name: 'Lonely' },
  session: { id: 's-lonely', expiresAt: '2099-01-01T00:00:00.000Z' },
  roles: ['viewer'],
  orgId: null,
  orgs: [],
};

const originalFetch = globalThis.fetch;
const originalAuthBase = Bun.env.AGENT_OS_AUTH_API_BASE;
const originalGateway = Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAuthBase === undefined) {
    delete Bun.env.AGENT_OS_AUTH_API_BASE;
  } else {
    Bun.env.AGENT_OS_AUTH_API_BASE = originalAuthBase;
  }
  if (originalGateway === undefined) {
    delete Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL;
  } else {
    Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL = originalGateway;
  }
});

function mockAuthFetch(opts: {
  sessionByCookie?: Record<string, AuthSession | null>;
  allowedByUserPerm?: Record<string, boolean>;
}): void {
  Bun.env.AGENT_OS_AUTH_API_BASE = 'http://auth.test';

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
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/session') && method === 'GET') {
      const session = opts.sessionByCookie?.[cookie];
      if (!session) {
        return Response.json(
          { user: null, session: null, roles: [] },
          { status: 401 },
        );
      }
      return Response.json(session);
    }

    if (url.endsWith('/permissions/check') && method === 'POST') {
      const session = opts.sessionByCookie?.[cookie];
      if (!session) {
        return Response.json({ error: 'unauthenticated' }, { status: 401 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        permission?: string;
      };
      const key = `${session.user.id}:${body.permission ?? ''}`;
      const allowed = opts.allowedByUserPerm?.[key] === true;
      return Response.json({ allowed, permission: body.permission });
    }

    return Response.json({ error: 'unexpected fetch' }, { status: 500 });
  }) as typeof fetch;
}

describe('resolveAuthApiBase', () => {
  test('defaults to gateway /api/ext/auth', () => {
    delete Bun.env.AGENT_OS_AUTH_API_BASE;
    delete Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL;
    expect(resolveAuthApiBase({})).toBe('http://127.0.0.1:5173/api/ext/auth');
  });

  test('AGENT_OS_AUTH_API_BASE wins', () => {
    expect(
      resolveAuthApiBase({ AGENT_OS_AUTH_API_BASE: 'http://127.0.0.1:6110/' }),
    ).toBe('http://127.0.0.1:6110');
  });
});

describe('@agentos/core/api/auth middleware', () => {
  test('requireSession → 401 without cookie', async () => {
    mockAuthFetch({ sessionByCookie: {} });
    const app = createApp();
    app.route(
      'GET',
      '/me',
      (c) => c.json({ email: getSession(c)?.user.email }),
      [requireSession],
    );
    const res = await app.fetch(new Request('http://localhost/me'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  test('requireSession → 200 and getSession populated', async () => {
    mockAuthFetch({
      sessionByCookie: { 'session=admin': ADMIN_SESSION },
    });
    const app = createApp();
    app.route(
      'GET',
      '/me',
      (c) => c.json({ email: getSession(c)?.user.email }),
      [requireSession],
    );
    const res = await app.fetch(
      new Request('http://localhost/me', {
        headers: { cookie: 'session=admin' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'admin@example.com' });
  });

  test('requireRoles denies viewer for admin role → 403', async () => {
    mockAuthFetch({
      sessionByCookie: { 'session=viewer': VIEWER_SESSION },
    });
    const app = createApp();
    app.route('GET', '/admin', (c) => c.json({ ok: true }), [
      requireRoles('admin'),
    ]);
    const res = await app.fetch(
      new Request('http://localhost/admin', {
        headers: { cookie: 'session=viewer' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  test('requireRoles allows admin', async () => {
    mockAuthFetch({
      sessionByCookie: { 'session=admin': ADMIN_SESSION },
    });
    const app = createApp();
    app.route(
      'GET',
      '/admin',
      (c) => c.json({ ok: true, role: getSession(c)?.roles[0] }),
      [requireRoles('admin')],
    );
    const res = await app.fetch(
      new Request('http://localhost/admin', {
        headers: { cookie: 'session=admin' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: 'admin' });
  });

  test('requirePermissions → 401 without session', async () => {
    mockAuthFetch({ sessionByCookie: {} });
    const app = createApp();
    app.route('GET', '/crm', (c) => c.json({ ok: true }), [
      requirePermissions('crm.read'),
    ]);
    const res = await app.fetch(new Request('http://localhost/crm'));
    expect(res.status).toBe(401);
  });

  test('requirePermissions → 403 when denied', async () => {
    mockAuthFetch({
      sessionByCookie: { 'session=viewer': VIEWER_SESSION },
      allowedByUserPerm: { 'u-viewer:crm.read': false },
    });
    const app = createApp();
    app.route('GET', '/crm', (c) => c.json({ ok: true }), [
      requirePermissions('crm.read'),
    ]);
    const res = await app.fetch(
      new Request('http://localhost/crm', {
        headers: { cookie: 'session=viewer' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  test('requirePermissions → 200 when allowed', async () => {
    mockAuthFetch({
      sessionByCookie: { 'session=admin': ADMIN_SESSION },
      allowedByUserPerm: { 'u-admin:crm.read': true },
    });
    const app = createApp();
    app.route(
      'GET',
      '/crm',
      (c) => c.json({ ok: true, user: getSession(c)?.user.id }),
      [requirePermissions('crm.read')],
    );
    const res = await app.fetch(
      new Request('http://localhost/crm', {
        headers: { cookie: 'session=admin' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user: 'u-admin' });
  });

  test('requireOrg → 403 when session has no orgId', async () => {
    mockAuthFetch({
      sessionByCookie: { 'session=lonely': NO_ORG_SESSION },
    });
    const app = createApp();
    app.route(
      'GET',
      '/tenant',
      (c) => c.json({ orgId: getSession(c)?.orgId }),
      [requireOrg],
    );
    const res = await app.fetch(
      new Request('http://localhost/tenant', {
        headers: { cookie: 'session=lonely' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  test('requireOrg → 200 when orgId present', async () => {
    mockAuthFetch({
      sessionByCookie: { 'session=admin': ADMIN_SESSION },
    });
    const app = createApp();
    app.route(
      'GET',
      '/tenant',
      (c) => c.json({ orgId: getSession(c)?.orgId }),
      [requireOrg],
    );
    const res = await app.fetch(
      new Request('http://localhost/tenant', {
        headers: { cookie: 'session=admin' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: 'org-1' });
  });
});
