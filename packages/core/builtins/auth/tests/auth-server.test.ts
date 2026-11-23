import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEMO_ADMIN,
  DEMO_VIEWER,
  PERMISSION_ADMIN_ONLY,
} from '@agentos/core/builtins/auth/api/lib/constants';
import { createAuth } from '@agentos/core/builtins/auth/api/lib/create-auth';
import { handleAuthRequest } from '@agentos/core/builtins/auth/api/lib/handle-request';

function cookieHeaderFrom(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

describe('builtin auth server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentos-auth-'));
  const dbPath = join(dir, 'auth.sqlite');
  let ctx: Awaited<ReturnType<typeof createAuth>>;

  test('boots with seeded demo users', async () => {
    ctx = await createAuth({
      databasePath: dbPath,
      baseURL: 'http://127.0.0.1:6110',
      secret: 'test-secret-at-least-32-characters-long!!',
    });
    expect(ctx.dialect).toBe('sqlite');
    const health = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/health'),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
  });

  test('sign-in → session cookie → GET /session returns user + roles', async () => {
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
    const cookie = cookieHeaderFrom(signIn);
    expect(cookie.length).toBeGreaterThan(0);

    const body = (await signIn.json()) as {
      user: { email: string };
      roles: string[];
    };
    expect(body.user.email).toBe(DEMO_ADMIN.email);
    expect(body.roles).toContain('admin');

    const session = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/session', {
        headers: { cookie },
      }),
    );
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as {
      user: { email: string };
      roles: string[];
    };
    expect(sessionBody.user.email).toBe(DEMO_ADMIN.email);
    expect(sessionBody.roles).toContain('admin');
  });

  test('unauthenticated /permissions/check → 401', async () => {
    const res = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/permissions/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permission: PERMISSION_ADMIN_ONLY }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test('viewer denied admin permission; admin allowed', async () => {
    const viewerSignIn = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: DEMO_VIEWER.email,
          password: DEMO_VIEWER.password,
        }),
      }),
    );
    expect(viewerSignIn.status).toBe(200);
    const viewerCookie = cookieHeaderFrom(viewerSignIn);

    const denied = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/permissions/check', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: viewerCookie,
        },
        body: JSON.stringify({ permission: PERMISSION_ADMIN_ONLY }),
      }),
    );
    expect(denied.status).toBe(200);
    expect(await denied.json()).toEqual({
      allowed: false,
      permission: PERMISSION_ADMIN_ONLY,
    });

    const adminSignIn = await handleAuthRequest(
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
    const adminCookie = cookieHeaderFrom(adminSignIn);
    const allowed = await handleAuthRequest(
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
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({
      allowed: true,
      permission: PERMISSION_ADMIN_ONLY,
    });
  });

  test('GET /me aliases /session', async () => {
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
    const cookie = cookieHeaderFrom(signIn);
    const me = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/me', { headers: { cookie } }),
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { email: string } };
    expect(body.user.email).toBe(DEMO_ADMIN.email);
  });

  test('sign-up creates session with viewer role', async () => {
    const email = `newbie-${Date.now()}@example.com`;
    const signUp = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
          name: 'Newbie',
        }),
      }),
    );
    expect(signUp.status).toBe(200);
    const body = (await signUp.json()) as {
      user: { email: string };
      roles: string[];
    };
    expect(body.user.email).toBe(email);
    expect(body.roles).toContain('viewer');
    expect(cookieHeaderFrom(signUp).length).toBeGreaterThan(0);
  });

  test('update-profile changes display name on session', async () => {
    const email = `profile-${Date.now()}@example.com`;
    const signUp = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
          name: 'Before Name',
        }),
      }),
    );
    expect(signUp.status).toBe(200);
    const cookie = cookieHeaderFrom(signUp);

    const update = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/update-profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'After Name' }),
      }),
    );
    expect(update.status).toBe(200);
    const updateBody = (await update.json()) as { user: { name: string } };
    expect(updateBody.user.name).toBe('After Name');

    const sessionCookie = cookieHeaderFrom(update) || cookie;
    const session = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/session', {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as { user: { name: string } };
    expect(sessionBody.user.name).toBe('After Name');
  });

  test('change-password rejects wrong current; accepts correct then signs in', async () => {
    const email = `pwchange-${Date.now()}@example.com`;
    const signUp = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
          name: 'Pw User',
        }),
      }),
    );
    expect(signUp.status).toBe(200);
    const cookie = cookieHeaderFrom(signUp);

    const wrong = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'wrong-password',
          newPassword: 'newpassword123',
        }),
      }),
    );
    expect(wrong.status).not.toBe(200);

    const change = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          currentPassword: 'password123',
          newPassword: 'newpassword123',
        }),
      }),
    );
    expect(change.status).toBe(200);
    expect(await change.json()).toEqual({ ok: true });

    const oldSignIn = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      }),
    );
    expect(oldSignIn.status).not.toBe(200);

    const newSignIn = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'newpassword123',
        }),
      }),
    );
    expect(newSignIn.status).toBe(200);
  });

  test('session includes orgId; create/list/switch orgs', async () => {
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
    const cookie = cookieHeaderFrom(signIn);
    const signInBody = (await signIn.json()) as {
      orgId: string | null;
      orgs: Array<{ id: string; name: string; role: string }>;
    };
    expect(signInBody.orgId).toBeTruthy();
    expect(signInBody.orgs.length).toBeGreaterThan(0);

    const created = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: `Acme ${Date.now()}` }),
      }),
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      org: { id: string; name: string };
      orgId: string | null;
      orgs: Array<{ id: string }>;
    };
    expect(createdBody.org.id).toBeTruthy();
    expect(createdBody.orgId).toBe(createdBody.org.id);
    expect(createdBody.orgs.some((o) => o.id === createdBody.org.id)).toBe(
      true,
    );

    const listed = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs', { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      orgId: string;
      orgs: Array<{ id: string }>;
    };
    expect(listedBody.orgId).toBe(createdBody.org.id);

    const otherOrgId = signInBody.orgs[0]!.id;
    const switched = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ orgId: otherOrgId }),
      }),
    );
    expect(switched.status).toBe(200);
    const switchedBody = (await switched.json()) as { orgId: string | null };
    expect(switchedBody.orgId).toBe(otherOrgId);

    const denied = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ orgId: 'nonexistent-org' }),
      }),
    );
    expect(denied.status).toBe(403);
  });

  test('forgot-password + reset-password round-trip', async () => {
    let capturedToken: string | null = null;
    const resetDir = mkdtempSync(join(tmpdir(), 'agentos-auth-reset-'));
    const resetCtx = await createAuth({
      databasePath: join(resetDir, 'auth.sqlite'),
      baseURL: 'http://127.0.0.1:6110',
      secret: 'test-secret-at-least-32-characters-long!!',
      seedDemoUsers: false,
      appOrigin: 'http://localhost:5173',
      sendResetPassword: async ({ token }) => {
        capturedToken = token;
      },
    });

    const email = `reset-${Date.now()}@example.com`;
    const signUp = await handleAuthRequest(
      resetCtx,
      new Request('http://127.0.0.1:6110/sign-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
          name: 'Reset User',
        }),
      }),
    );
    expect(signUp.status).toBe(200);

    const forgot = await handleAuthRequest(
      resetCtx,
      new Request('http://127.0.0.1:6110/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          redirectTo: 'http://localhost:5173/reset-password',
        }),
      }),
    );
    expect(forgot.status).toBe(200);
    expect(capturedToken).toBeTruthy();

    const reset = await handleAuthRequest(
      resetCtx,
      new Request('http://127.0.0.1:6110/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: capturedToken,
          newPassword: 'newpassword123',
        }),
      }),
    );
    expect(reset.status).toBe(200);

    const signIn = await handleAuthRequest(
      resetCtx,
      new Request('http://127.0.0.1:6110/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'newpassword123',
        }),
      }),
    );
    expect(signIn.status).toBe(200);

    await resetCtx.close();
    rmSync(resetDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
