import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEMO_ADMIN,
  PERMISSION_ADMIN_ONLY,
} from '@agentos/core/builtins/auth/api/lib/constants';
import { createAuth } from '@agentos/core/builtins/auth/api/lib/create-auth';
import { handleAuthRequest } from '@agentos/core/builtins/auth/api/lib/handle-request';
import {
  permissionCacheKey,
  type PermissionCacheFetch,
} from '@agentos/core/builtins/auth/api/lib/permission-cache';
import { createMemoryCache } from '@agentos/core/builtins/cache-store/api/lib/create-cache';
import { handleCacheStoreRequest } from '@agentos/core/builtins/cache-store/api/lib/handle-request';

function cookieHeaderFrom(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

describe('auth permission check + cache-store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentos-auth-cache-'));
  const dbPath = join(dir, 'auth.sqlite');
  const memory = createMemoryCache();

  const fetchImpl: PermissionCacheFetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === 'string'
        ? init.body
        : init?.body
          ? String(init.body)
          : undefined;
    return handleCacheStoreRequest(
      memory,
      new Request(url, { method, headers, body }),
    );
  };

  let ctx: Awaited<ReturnType<typeof createAuth>>;
  let adminCookie = '';
  let adminUserId = '';
  let adminOrgId: string | null = null;

  test('setup auth with in-process cache-store fetch', async () => {
    ctx = await createAuth({
      databasePath: dbPath,
      baseURL: 'http://127.0.0.1:6110',
      secret: 'test-secret-at-least-32-characters-long!!',
      permissionCache: {
        baseUrl: 'http://127.0.0.1:6112',
        fetchImpl,
        ttlSeconds: 30,
      },
    });

    const signIn = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: DEMO_ADMIN.email,
          password: DEMO_ADMIN.password,
        }),
      }),
    );
    expect(signIn.status).toBe(200);
    adminCookie = cookieHeaderFrom(signIn);
    const body = (await signIn.json()) as {
      user: { id: string };
      orgId: string | null;
    };
    adminUserId = body.user.id;
    adminOrgId = body.orgId;
  });

  test('miss → SQLite then cache hit on second check', async () => {
    const first = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/permissions/check', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: adminCookie,
        },
        body: JSON.stringify({ permission: PERMISSION_ADMIN_ONLY }),
      }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      allowed: true,
      permission: PERMISSION_ADMIN_ONLY,
    });

    const cacheUser = adminOrgId
      ? `${adminUserId}:${adminOrgId}`
      : adminUserId;
    const key = permissionCacheKey(cacheUser, PERMISSION_ADMIN_ONLY);
    expect(memory.get(key)).toEqual({ allowed: true });

    // Overwrite cache to prove subsequent reads skip SQLite.
    memory.set(key, { allowed: false }, 30);

    const second = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/permissions/check', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: adminCookie,
        },
        body: JSON.stringify({ permission: PERMISSION_ADMIN_ONLY }),
      }),
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      allowed: false,
      permission: PERMISSION_ADMIN_ONLY,
    });
  });

  test('cache-store down → still returns SQLite result', async () => {
    const downFetch: PermissionCacheFetch = async () => {
      throw new Error('connection refused');
    };

    const downCtx = await createAuth({
      databasePath: join(dir, 'auth-down.sqlite'),
      baseURL: 'http://127.0.0.1:6110',
      secret: 'test-secret-at-least-32-characters-long!!',
      permissionCache: {
        baseUrl: 'http://127.0.0.1:6112',
        fetchImpl: downFetch,
      },
    });

    const signIn = await handleAuthRequest(
      downCtx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: DEMO_ADMIN.email,
          password: DEMO_ADMIN.password,
        }),
      }),
    );
    const cookie = cookieHeaderFrom(signIn);

    const check = await handleAuthRequest(
      downCtx,
      new Request('http://127.0.0.1:6110/permissions/check', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
        },
        body: JSON.stringify({ permission: PERMISSION_ADMIN_ONLY }),
      }),
    );
    expect(check.status).toBe(200);
    expect(await check.json()).toEqual({
      allowed: true,
      permission: PERMISSION_ADMIN_ONLY,
    });

    await downCtx.close();
  });

  afterAll(async () => {
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
