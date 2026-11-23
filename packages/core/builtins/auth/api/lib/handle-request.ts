import { isAPIError } from 'better-auth/api';

import { DEMO_VIEWER } from './constants';
import type { AuthContext } from './create-auth';
import {
  createOrganization,
  isOrgMember,
  listOrgsForUser,
  resolveActiveOrgId,
  setActiveOrg,
} from './org-store';
import { cacheGetAllowed, cacheSetAllowed } from './permission-cache';
import {
  assignUserRole,
  listRolesForUser,
  userHasPermission,
} from './rbac-store';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function mergeSetCookie(from: Headers, into: Headers): void {
  const cookies =
    typeof from.getSetCookie === 'function'
      ? from.getSetCookie()
      : from.get('set-cookie')
        ? [from.get('set-cookie')!]
        : [];
  for (const cookie of cookies) {
    into.append('set-cookie', cookie);
  }
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

async function requireSession(ctx: AuthContext, request: Request) {
  return ctx.auth.api.getSession({ headers: request.headers });
}

async function sessionPayload(
  ctx: AuthContext,
  session: NonNullable<Awaited<ReturnType<typeof requireSession>>>,
) {
  const roles = await listRolesForUser(ctx.db, session.user.id);
  const orgs = await listOrgsForUser(ctx.db, session.user.id);
  const orgId = await resolveActiveOrgId(ctx.db, session.user.id);
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
    session: {
      id: session.session.id,
      expiresAt: session.session.expiresAt,
    },
    roles,
    orgId,
    orgs,
  };
}

/**
 * Thin Bun request router for `/api/ext/auth/*` upstream paths.
 */
export async function handleAuthRequest(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({ ok: true });
  }

  if (method === 'GET' && (path === '/session' || path === '/me')) {
    const session = await requireSession(ctx, request);
    if (!session) {
      return json(
        { user: null, session: null, roles: [], orgId: null, orgs: [] },
        { status: 401 },
      );
    }
    return json(await sessionPayload(ctx, session));
  }

  if (method === 'GET' && path === '/orgs') {
    const session = await requireSession(ctx, request);
    if (!session) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    const orgs = await listOrgsForUser(ctx.db, session.user.id);
    const orgId = await resolveActiveOrgId(ctx.db, session.user.id);
    return json({ orgs, orgId });
  }

  if (method === 'POST' && path === '/orgs') {
    const session = await requireSession(ctx, request);
    if (!session) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = await readJsonBody(request);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return json({ error: 'name required' }, { status: 400 });
    }
    try {
      const org = await createOrganization(ctx.db, {
        name,
        creatorUserId: session.user.id,
      });
      return json({
        org,
        ...(await sessionPayload(ctx, session)),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'create organization failed';
      return json({ error: message }, { status: 400 });
    }
  }

  if (method === 'POST' && path === '/orgs/switch') {
    const session = await requireSession(ctx, request);
    if (!session) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = await readJsonBody(request);
    const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : '';
    if (!orgId) {
      return json({ error: 'orgId required' }, { status: 400 });
    }
    const member = await isOrgMember(ctx.db, session.user.id, orgId);
    if (!member) {
      return json({ error: 'forbidden' }, { status: 403 });
    }
    await setActiveOrg(ctx.db, session.user.id, orgId);
    return json(await sessionPayload(ctx, session));
  }

  if (method === 'POST' && path === '/sign-in') {
    const body = await readJsonBody(request);
    const email = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || !password) {
      return json({ error: 'email and password required' }, { status: 400 });
    }

    try {
      const response = await ctx.auth.api.signInEmail({
        body: { email, password },
        headers: request.headers,
        asResponse: true,
      });

      const outHeaders = new Headers();
      mergeSetCookie(response.headers, outHeaders);

      if (!response.ok) {
        const errBody = await response.text();
        return new Response(
          errBody || JSON.stringify({ error: 'sign-in failed' }),
          {
            status: response.status,
            headers: outHeaders,
          },
        );
      }

      const session = await ctx.auth.api.getSession({
        headers: (() => {
          const h = new Headers(request.headers);
          const cookies =
            typeof response.headers.getSetCookie === 'function'
              ? response.headers.getSetCookie()
              : [];
          if (cookies.length > 0) {
            h.set('cookie', cookies.map((c) => c.split(';')[0]).join('; '));
          }
          return h;
        })(),
      });

      if (!session) {
        return json(
          { error: 'sign-in succeeded but no session' },
          {
            status: 500,
            headers: outHeaders,
          },
        );
      }

      return json(await sessionPayload(ctx, session), {
        status: 200,
        headers: outHeaders,
      });
    } catch (error) {
      if (isAPIError(error)) {
        return json(
          { error: error.message ?? 'sign-in failed' },
          { status: typeof error.status === 'number' ? error.status : 401 },
        );
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/sign-out') {
    try {
      const response = await ctx.auth.api.signOut({
        headers: request.headers,
        asResponse: true,
      });
      const outHeaders = new Headers();
      mergeSetCookie(response.headers, outHeaders);
      return json({ ok: true }, { status: 200, headers: outHeaders });
    } catch (error) {
      if (isAPIError(error)) {
        return json(
          { error: error.message ?? 'sign-out failed' },
          { status: typeof error.status === 'number' ? error.status : 400 },
        );
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/sign-up') {
    const body = await readJsonBody(request);
    const email = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const name =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim()
        : email.split('@')[0] || 'User';
    if (!email || !password) {
      return json({ error: 'email and password required' }, { status: 400 });
    }

    try {
      const response = await ctx.auth.api.signUpEmail({
        body: { email, password, name },
        headers: request.headers,
        asResponse: true,
      });

      const outHeaders = new Headers();
      mergeSetCookie(response.headers, outHeaders);

      if (!response.ok) {
        const errBody = await response.text();
        return new Response(
          errBody || JSON.stringify({ error: 'sign-up failed' }),
          {
            status: response.status,
            headers: outHeaders,
          },
        );
      }

      const session = await ctx.auth.api.getSession({
        headers: (() => {
          const h = new Headers(request.headers);
          const cookies =
            typeof response.headers.getSetCookie === 'function'
              ? response.headers.getSetCookie()
              : [];
          if (cookies.length > 0) {
            h.set('cookie', cookies.map((c) => c.split(';')[0]).join('; '));
          }
          return h;
        })(),
      });

      if (!session) {
        return json(
          { error: 'sign-up succeeded but no session' },
          {
            status: 500,
            headers: outHeaders,
          },
        );
      }

      await assignUserRole(ctx.db, session.user.id, DEMO_VIEWER.role);

      return json(await sessionPayload(ctx, session), {
        status: 200,
        headers: outHeaders,
      });
    } catch (error) {
      if (isAPIError(error)) {
        return json(
          { error: error.message ?? 'sign-up failed' },
          { status: typeof error.status === 'number' ? error.status : 400 },
        );
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/forgot-password') {
    const body = await readJsonBody(request);
    const email = typeof body?.email === 'string' ? body.email : '';
    const redirectTo =
      typeof body?.redirectTo === 'string' && body.redirectTo
        ? body.redirectTo
        : undefined;
    if (!email) {
      return json({ error: 'email required' }, { status: 400 });
    }

    try {
      await ctx.auth.api.requestPasswordReset({
        body: {
          email,
          ...(redirectTo ? { redirectTo } : {}),
        },
        headers: request.headers,
      });
      return json({
        ok: true,
        message:
          'If this email exists in our system, check your email for the reset link',
      });
    } catch (error) {
      if (isAPIError(error)) {
        return json(
          { error: error.message ?? 'forgot-password failed' },
          { status: typeof error.status === 'number' ? error.status : 400 },
        );
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/reset-password') {
    const body = await readJsonBody(request);
    const token = typeof body?.token === 'string' ? body.token : '';
    const newPassword =
      typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (!token || !newPassword) {
      return json({ error: 'token and newPassword required' }, { status: 400 });
    }

    try {
      await ctx.auth.api.resetPassword({
        body: { token, newPassword },
        headers: request.headers,
      });
      return json({ ok: true });
    } catch (error) {
      if (isAPIError(error)) {
        return json(
          { error: error.message ?? 'reset-password failed' },
          { status: typeof error.status === 'number' ? error.status : 400 },
        );
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/update-profile') {
    const session = await requireSession(ctx, request);
    if (!session) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = await readJsonBody(request);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return json({ error: 'name required' }, { status: 400 });
    }

    try {
      const response = await ctx.auth.api.updateUser({
        body: { name },
        headers: request.headers,
        asResponse: true,
      });

      const outHeaders = new Headers();
      mergeSetCookie(response.headers, outHeaders);

      if (!response.ok) {
        const errBody = await response.text();
        return new Response(
          errBody || JSON.stringify({ error: 'update-profile failed' }),
          {
            status: response.status,
            headers: outHeaders,
          },
        );
      }

      const refreshed = await ctx.auth.api.getSession({
        headers: (() => {
          const h = new Headers(request.headers);
          const cookies =
            typeof response.headers.getSetCookie === 'function'
              ? response.headers.getSetCookie()
              : [];
          if (cookies.length > 0) {
            h.set('cookie', cookies.map((c) => c.split(';')[0]).join('; '));
          }
          return h;
        })(),
      });

      if (!refreshed) {
        return json(
          { error: 'update-profile succeeded but no session' },
          { status: 500, headers: outHeaders },
        );
      }

      return json(await sessionPayload(ctx, refreshed), {
        status: 200,
        headers: outHeaders,
      });
    } catch (error) {
      if (isAPIError(error)) {
        return json(
          { error: error.message ?? 'update-profile failed' },
          { status: typeof error.status === 'number' ? error.status : 400 },
        );
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/change-password') {
    const session = await requireSession(ctx, request);
    if (!session) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = await readJsonBody(request);
    const currentPassword =
      typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword =
      typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (!currentPassword || !newPassword) {
      return json(
        { error: 'currentPassword and newPassword required' },
        { status: 400 },
      );
    }

    try {
      const response = await ctx.auth.api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        headers: request.headers,
        asResponse: true,
      });

      const outHeaders = new Headers();
      mergeSetCookie(response.headers, outHeaders);

      if (!response.ok) {
        const errBody = await response.text();
        return new Response(
          errBody || JSON.stringify({ error: 'change-password failed' }),
          {
            status: response.status,
            headers: outHeaders,
          },
        );
      }

      return json({ ok: true }, { status: 200, headers: outHeaders });
    } catch (error) {
      if (isAPIError(error)) {
        return json(
          { error: error.message ?? 'change-password failed' },
          { status: typeof error.status === 'number' ? error.status : 400 },
        );
      }
      throw error;
    }
  }

  if (method === 'POST' && path === '/permissions/check') {
    const session = await requireSession(ctx, request);
    if (!session) {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    const body = await readJsonBody(request);
    const permission =
      typeof body?.permission === 'string' ? body.permission : '';
    if (!permission) {
      return json({ error: 'permission required' }, { status: 400 });
    }

    if (ctx.permissionCache) {
      const cached = await cacheGetAllowed(
        ctx.permissionCache,
        session.user.id,
        permission,
      );
      if (typeof cached === 'boolean') {
        return json({ allowed: cached, permission });
      }
    }

    const allowed = await userHasPermission(
      ctx.db,
      session.user.id,
      permission,
    );

    if (ctx.permissionCache) {
      await cacheSetAllowed(
        ctx.permissionCache,
        session.user.id,
        permission,
        allowed,
      );
    }

    return json({ allowed, permission });
  }

  return json({ error: 'not found' }, { status: 404 });
}
