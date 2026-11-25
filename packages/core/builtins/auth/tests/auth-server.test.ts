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
import { ensureDemoOrgMembership } from '@agentos/core/builtins/auth/api/lib/org-store';

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

  test('role admin: viewer denied; admin can list/assign', async () => {
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
      new Request('http://127.0.0.1:6110/orgs/members/roles', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: viewerCookie,
        },
        body: JSON.stringify({
          userId: 'anyone',
          role: 'admin',
        }),
      }),
    );
    expect(denied.status).toBe(403);

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
    expect(adminSignIn.status).toBe(200);
    const adminCookie = cookieHeaderFrom(adminSignIn);

    const rolesRes = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/roles', {
        headers: { cookie: adminCookie },
      }),
    );
    expect(rolesRes.status).toBe(200);
    const rolesBody = (await rolesRes.json()) as {
      roles: string[];
      permissions: Array<{ role: string; permission: string }>;
    };
    expect(rolesBody.roles).toContain('admin');
    expect(rolesBody.roles).toContain('external_viewer');
    expect(rolesBody.roles).toContain('reviewer');

    const membersRes = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/members', {
        headers: { cookie: adminCookie },
      }),
    );
    expect(membersRes.status).toBe(200);
    const membersBody = (await membersRes.json()) as {
      orgId: string;
      members: Array<{ userId: string; email: string; role: string }>;
    };
    const viewerMember = membersBody.members.find(
      (m) => m.email === DEMO_VIEWER.email,
    );
    expect(viewerMember).toBeTruthy();

    const assigned = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/members/roles', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: adminCookie,
        },
        body: JSON.stringify({
          userId: viewerMember!.userId,
          role: 'reviewer',
        }),
      }),
    );
    expect(assigned.status).toBe(200);
    const assignedBody = (await assigned.json()) as {
      members: Array<{ userId: string; role: string }>;
    };
    expect(
      assignedBody.members.find((m) => m.userId === viewerMember!.userId)?.role,
    ).toBe('reviewer');
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

  test('remove member: admin only, purges via hook, membership gone', async () => {
    const email = `leaver-${Date.now()}@example.com`;
    const signUp = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
          name: 'Leaver',
        }),
      }),
    );
    expect(signUp.status).toBe(200);
    const leaver = (await signUp.json()) as { user: { id: string } };
    const leaverCookie = cookieHeaderFrom(signUp);
    const demoOrgId = await ensureDemoOrgMembership(
      ctx.db,
      leaver.user.id,
      undefined,
      'viewer',
    );

    const removed: Array<{ orgId: string; userId: string }> = [];
    ctx.onMemberRemoved = async (input) => {
      removed.push(input);
    };

    const remove = (cookie: string, userId: string) =>
      handleAuthRequest(
        ctx,
        new Request('http://127.0.0.1:6110/orgs/members/remove', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ userId }),
        }),
      );

    expect((await remove(leaverCookie, leaver.user.id)).status).toBe(403);

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
    const admin = (await adminSignIn.json()) as {
      user: { id: string };
      orgId: string;
    };
    expect(admin.orgId).toBe(demoOrgId);

    expect((await remove(adminCookie, admin.user.id)).status).toBe(400);
    expect((await remove(adminCookie, 'nobody')).status).toBe(404);

    const ok = await remove(adminCookie, leaver.user.id);
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      removed: string;
      members: Array<{ userId: string }>;
    };
    expect(okBody.removed).toBe(leaver.user.id);
    expect(okBody.members.some((m) => m.userId === leaver.user.id)).toBe(false);
    expect(removed).toEqual([{ orgId: admin.orgId, userId: leaver.user.id }]);

    const session = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/session', {
        headers: { cookie: leaverCookie },
      }),
    );
    const sessionBody = (await session.json()) as {
      orgs: Array<{ id: string }>;
    };
    expect(sessionBody.orgs.some((o) => o.id === admin.orgId)).toBe(false);
    ctx.onMemberRemoved = undefined;
  });

  test('org/role CRUD and non-admin read access (ticket 128)', async () => {
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

    const viewerRoles = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/roles', {
        headers: { cookie: viewerCookie },
      }),
    );
    expect(viewerRoles.status).toBe(200);
    const viewerMembers = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/members', {
        headers: { cookie: viewerCookie },
      }),
    );
    expect(viewerMembers.status).toBe(200);

    const viewerCreateOrg = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: viewerCookie },
        body: JSON.stringify({ name: 'Denied Org' }),
      }),
    );
    expect(viewerCreateOrg.status).toBe(403);

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

    const created = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ name: 'Temp Org' }),
      }),
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { org: { id: string } };

    const renamed = await handleAuthRequest(
      ctx,
      new Request(`http://127.0.0.1:6110/orgs/${createdBody.org.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ name: 'Renamed Org' }),
      }),
    );
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { org: { name: string } }).org.name).toBe(
      'Renamed Org',
    );

    const deletedOrg = await handleAuthRequest(
      ctx,
      new Request(`http://127.0.0.1:6110/orgs/${createdBody.org.id}`, {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }),
    );
    expect(deletedOrg.status).toBe(200);

    const putRole = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/roles/analyst/permissions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ permissions: ['files.read', 'audit.read'] }),
      }),
    );
    expect(putRole.status).toBe(200);

    const deleteProtected = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/roles/admin', {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }),
    );
    expect(deleteProtected.status).toBe(400);

    const deleteCustom = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/roles/analyst', {
        method: 'DELETE',
        headers: { cookie: adminCookie },
      }),
    );
    expect(deleteCustom.status).toBe(200);
    const deleteCustomBody = (await deleteCustom.json()) as {
      deleted: string;
      roles: string[];
    };
    expect(deleteCustomBody.deleted).toBe('analyst');
    expect(deleteCustomBody.roles).not.toContain('analyst');

    // Invite member: non-admin denied; admin creates pending invite, sign-up auto-joins
    const viewerInvite = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/members/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: viewerCookie },
        body: JSON.stringify({ email: 'denied@example.com', role: 'viewer' }),
      }),
    );
    expect(viewerInvite.status).toBe(403);

    const inviteEmail = `invited-${Date.now()}@example.com`;
    const invited = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/members/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ email: inviteEmail, role: 'reviewer' }),
      }),
    );
    expect(invited.status).toBe(200);
    const invitedBody = (await invited.json()) as {
      status: string;
      orgId: string;
      invite: { id: string; email: string; role: string };
      invites: Array<{ id: string; email: string }>;
    };
    expect(invitedBody.status).toBe('invited');
    expect(invitedBody.invites.some((i) => i.email === inviteEmail)).toBe(true);

    // Revoke another invite
    const revokeEmail = `revoke-${Date.now()}@example.com`;
    const invited2 = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/orgs/members/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({ email: revokeEmail, role: 'viewer' }),
      }),
    );
    const invited2Body = (await invited2.json()) as { invite: { id: string } };
    const revoked = await handleAuthRequest(
      ctx,
      new Request(
        `http://127.0.0.1:6110/orgs/invites/${invited2Body.invite.id}`,
        { method: 'DELETE', headers: { cookie: adminCookie } },
      ),
    );
    expect(revoked.status).toBe(200);

    // Invited user signs up → automatically joins org with invited role
    const invitedSignUp = await handleAuthRequest(
      ctx,
      new Request('http://127.0.0.1:6110/sign-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          password: 'password123',
          name: 'Invited User',
        }),
      }),
    );
    expect(invitedSignUp.status).toBe(200);
    const invitedSession = (await invitedSignUp.json()) as {
      orgId: string | null;
      orgs: Array<{ id: string; role: string }>;
    };
    expect(invitedSession.orgId).toBe(invitedBody.orgId);
    expect(
      invitedSession.orgs.find((o) => o.id === invitedBody.orgId)?.role,
    ).toBe('reviewer');
  });

  afterAll(async () => {
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
