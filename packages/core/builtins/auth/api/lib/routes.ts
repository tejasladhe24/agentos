import { DEMO_VIEWER, PERMISSION_ROLES_MANAGE } from './constants';
import type { AuthContext } from './create-auth';
import {
  apiErrorResponse,
  cookieHeaderFrom,
  forwardAuthFailure,
  json,
  mergeSetCookie,
  readJsonBody,
} from './http';
import {
  createOrganization,
  isOrgMember,
  listOrgMembers,
  listOrgsForUser,
  resolveActiveOrgId,
  setActiveOrg,
  setOrgMemberRole,
} from './org-store';
import { cacheGetAllowed, cacheSetAllowed } from './permission-cache';
import {
  assignUserRole,
  listRolePermissions,
  listRoles,
  listRolesForUser,
  setRolePermissions,
  userHasPermission,
} from './rbac-store';

type AuthSession = NonNullable<
  Awaited<ReturnType<AuthContext['auth']['api']['getSession']>>
>;

export type AuthRouteHandler = (
  ctx: AuthContext,
  request: Request,
  path: string,
) => Promise<Response>;

async function requireSession(ctx: AuthContext, request: Request) {
  return ctx.auth.api.getSession({ headers: request.headers });
}

async function sessionPayload(ctx: AuthContext, session: AuthSession) {
  const orgs = await listOrgsForUser(ctx.db, session.user.id);
  const orgId = await resolveActiveOrgId(ctx.db, session.user.id);
  const roles = await listRolesForUser(ctx.db, session.user.id, orgId);
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

async function requireManageRoles(
  ctx: AuthContext,
  request: Request,
): Promise<
  | { ok: true; session: AuthSession; orgId: string }
  | { ok: false; response: Response }
> {
  const session = await requireSession(ctx, request);
  if (!session) {
    return {
      ok: false,
      response: json({ error: 'unauthenticated' }, { status: 401 }),
    };
  }
  const orgId = await resolveActiveOrgId(ctx.db, session.user.id);
  if (!orgId) {
    return {
      ok: false,
      response: json({ error: 'forbidden' }, { status: 403 }),
    };
  }
  const allowed = await userHasPermission(
    ctx.db,
    session.user.id,
    PERMISSION_ROLES_MANAGE,
    orgId,
  );
  if (!allowed) {
    return {
      ok: false,
      response: json({ error: 'forbidden' }, { status: 403 }),
    };
  }
  return { ok: true, session, orgId };
}

/** Merge Set-Cookie from an auth response into request headers for getSession. */
function headersWithAuthCookies(
  request: Request,
  authResponse: Response,
): Headers {
  const h = new Headers(request.headers);
  const cookie = cookieHeaderFrom(authResponse);
  if (cookie) h.set('cookie', cookie);
  return h;
}

async function sessionJsonFromAuthResponse(
  ctx: AuthContext,
  request: Request,
  authResponse: Response,
  messages: { failure: string; missingSession: string },
): Promise<Response> {
  if (!authResponse.ok) {
    return forwardAuthFailure(authResponse, messages.failure);
  }

  const outHeaders = new Headers();
  mergeSetCookie(authResponse.headers, outHeaders);

  const session = await ctx.auth.api.getSession({
    headers: headersWithAuthCookies(request, authResponse),
  });
  if (!session) {
    return json(
      { error: messages.missingSession },
      { status: 500, headers: outHeaders },
    );
  }
  return json(await sessionPayload(ctx, session), {
    status: 200,
    headers: outHeaders,
  });
}

// --- Route handlers -------------------------------------------------------

export async function handleHealth(): Promise<Response> {
  return json({ ok: true });
}

export async function handleSession(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const session = await requireSession(ctx, request);
  if (!session) {
    return json(
      { user: null, session: null, roles: [], orgId: null, orgs: [] },
      { status: 401 },
    );
  }
  return json(await sessionPayload(ctx, session));
}

export async function handleListOrgs(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const session = await requireSession(ctx, request);
  if (!session) {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  const orgs = await listOrgsForUser(ctx.db, session.user.id);
  const orgId = await resolveActiveOrgId(ctx.db, session.user.id);
  return json({ orgs, orgId });
}

export async function handleCreateOrg(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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

export async function handleSwitchOrg(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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

export async function handleSignIn(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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
    return sessionJsonFromAuthResponse(ctx, request, response, {
      failure: 'sign-in failed',
      missingSession: 'sign-in succeeded but no session',
    });
  } catch (error) {
    return apiErrorResponse(error, 'sign-in failed', 401);
  }
}

export async function handleSignOut(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  try {
    const response = await ctx.auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    });
    const outHeaders = new Headers();
    mergeSetCookie(response.headers, outHeaders);
    return json({ ok: true }, { status: 200, headers: outHeaders });
  } catch (error) {
    return apiErrorResponse(error, 'sign-out failed', 400);
  }
}

export async function handleSignUp(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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
      return forwardAuthFailure(response, 'sign-up failed');
    }

    const session = await ctx.auth.api.getSession({
      headers: headersWithAuthCookies(request, response),
    });
    if (!session) {
      return json(
        { error: 'sign-up succeeded but no session' },
        { status: 500, headers: outHeaders },
      );
    }

    await assignUserRole(ctx.db, session.user.id, DEMO_VIEWER.role);

    return json(await sessionPayload(ctx, session), {
      status: 200,
      headers: outHeaders,
    });
  } catch (error) {
    return apiErrorResponse(error, 'sign-up failed', 400);
  }
}

export async function handleForgotPassword(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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
    return apiErrorResponse(error, 'forgot-password failed', 400);
  }
}

export async function handleResetPassword(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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
    return apiErrorResponse(error, 'reset-password failed', 400);
  }
}

export async function handleUpdateProfile(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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
    return sessionJsonFromAuthResponse(ctx, request, response, {
      failure: 'update-profile failed',
      missingSession: 'update-profile succeeded but no session',
    });
  } catch (error) {
    return apiErrorResponse(error, 'update-profile failed', 400);
  }
}

export async function handleChangePassword(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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
      return forwardAuthFailure(response, 'change-password failed');
    }

    return json({ ok: true }, { status: 200, headers: outHeaders });
  } catch (error) {
    return apiErrorResponse(error, 'change-password failed', 400);
  }
}

export async function handlePermissionsCheck(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
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

  const orgId = await resolveActiveOrgId(ctx.db, session.user.id);
  const cacheKeyUser = orgId ? `${session.user.id}:${orgId}` : session.user.id;

  if (ctx.permissionCache) {
    const cached = await cacheGetAllowed(
      ctx.permissionCache,
      cacheKeyUser,
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
    orgId,
  );

  if (ctx.permissionCache) {
    await cacheSetAllowed(
      ctx.permissionCache,
      cacheKeyUser,
      permission,
      allowed,
    );
  }

  return json({ allowed, permission });
}

export async function handleListRoles(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const gate = await requireManageRoles(ctx, request);
  if (!gate.ok) return gate.response;
  const roles = await listRoles(ctx.db);
  const permissions = await listRolePermissions(ctx.db);
  return json({ roles, permissions });
}

export async function handleListOrgMembers(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const gate = await requireManageRoles(ctx, request);
  if (!gate.ok) return gate.response;
  const members = await listOrgMembers(ctx.db, gate.orgId);
  return json({ orgId: gate.orgId, members });
}

export async function handleAssignOrgMemberRole(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const gate = await requireManageRoles(ctx, request);
  if (!gate.ok) return gate.response;
  const body = await readJsonBody(request);
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const role = typeof body?.role === 'string' ? body.role.trim() : '';
  if (!userId || !role) {
    return json({ error: 'userId and role required' }, { status: 400 });
  }
  const updated = await setOrgMemberRole(ctx.db, gate.orgId, userId, role);
  if (!updated) {
    return json({ error: 'member not found' }, { status: 404 });
  }
  const members = await listOrgMembers(ctx.db, gate.orgId);
  return json({ orgId: gate.orgId, members });
}

export async function handleSetRolePermissions(
  ctx: AuthContext,
  request: Request,
  path: string,
): Promise<Response> {
  const gate = await requireManageRoles(ctx, request);
  if (!gate.ok) return gate.response;
  const role = decodeURIComponent(
    path.slice('/roles/'.length, -'/permissions'.length),
  ).trim();
  if (!role) {
    return json({ error: 'role required' }, { status: 400 });
  }
  const body = await readJsonBody(request);
  const permissions = Array.isArray(body?.permissions)
    ? body.permissions.filter((p): p is string => typeof p === 'string')
    : null;
  if (!permissions) {
    return json({ error: 'permissions array required' }, { status: 400 });
  }
  try {
    await setRolePermissions(ctx.db, role, permissions);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'update role permissions failed';
    return json({ error: message }, { status: 400 });
  }
  const catalog = await listRolePermissions(ctx.db);
  return json({
    role,
    permissions: catalog
      .filter((row) => row.role === role)
      .map((row) => row.permission),
  });
}

export async function handleSignInSso(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const body = await readJsonBody(request);
  const callbackURL =
    typeof body?.callbackURL === 'string' && body.callbackURL
      ? body.callbackURL
      : undefined;
  if (!callbackURL) {
    return json({ error: 'callbackURL required' }, { status: 400 });
  }

  try {
    let callbackOrigin: string;
    try {
      callbackOrigin = new URL(callbackURL).origin;
    } catch {
      return json({ error: 'invalid callbackURL' }, { status: 400 });
    }

    // auth.api.signInSSO does not enforce trustedOrigins — gate here.
    const trusted = ctx.auth.options.trustedOrigins;
    const allowedOrigins = new Set(
      Array.isArray(trusted)
        ? trusted.filter((o): o is string => typeof o === 'string')
        : [],
    );
    if (allowedOrigins.size > 0 && !allowedOrigins.has(callbackOrigin)) {
      return json({ error: 'untrusted callbackURL' }, { status: 400 });
    }

    const signInSSO = (
      ctx.auth.api as {
        signInSSO?: (args: {
          body: Record<string, unknown>;
          headers?: HeadersInit;
          asResponse?: boolean;
        }) => Promise<Response | { url?: string; redirect?: boolean }>;
      }
    ).signInSSO;
    if (!signInSSO) {
      return json({ error: 'SSO not available' }, { status: 501 });
    }

    const ssoBody = {
      callbackURL,
      ...(typeof body?.email === 'string' ? { email: body.email } : {}),
      ...(typeof body?.domain === 'string' ? { domain: body.domain } : {}),
      ...(typeof body?.providerId === 'string'
        ? { providerId: body.providerId }
        : {}),
      ...(typeof body?.providerType === 'string'
        ? { providerType: body.providerType }
        : {}),
      ...(typeof body?.errorCallbackURL === 'string'
        ? { errorCallbackURL: body.errorCallbackURL }
        : {}),
      ...(typeof body?.newUserCallbackURL === 'string'
        ? { newUserCallbackURL: body.newUserCallbackURL }
        : {}),
    };

    const response = (await signInSSO({
      body: ssoBody,
      headers: request.headers,
      asResponse: true,
    })) as Response;

    const outHeaders = new Headers();
    mergeSetCookie(response.headers, outHeaders);
    if (!response.ok) {
      return forwardAuthFailure(response, 'sign-in/sso failed');
    }
    const data = (await response.json()) as {
      url?: string;
      redirect?: boolean;
    };
    return json(data, { status: 200, headers: outHeaders });
  } catch (error) {
    return apiErrorResponse(error, 'sign-in/sso failed', 400);
  }
}

/** Exact method+path routes (path params handled separately). */
export const AUTH_EXACT_ROUTES: ReadonlyArray<{
  method: string;
  path: string;
  handle: AuthRouteHandler;
}> = [
  { method: 'GET', path: '/health', handle: (_c, _r) => handleHealth() },
  { method: 'GET', path: '/session', handle: (c, r) => handleSession(c, r) },
  { method: 'GET', path: '/me', handle: (c, r) => handleSession(c, r) },
  { method: 'GET', path: '/orgs', handle: (c, r) => handleListOrgs(c, r) },
  { method: 'POST', path: '/orgs', handle: (c, r) => handleCreateOrg(c, r) },
  {
    method: 'POST',
    path: '/orgs/switch',
    handle: (c, r) => handleSwitchOrg(c, r),
  },
  { method: 'POST', path: '/sign-in', handle: (c, r) => handleSignIn(c, r) },
  { method: 'POST', path: '/sign-out', handle: (c, r) => handleSignOut(c, r) },
  { method: 'POST', path: '/sign-up', handle: (c, r) => handleSignUp(c, r) },
  {
    method: 'POST',
    path: '/forgot-password',
    handle: (c, r) => handleForgotPassword(c, r),
  },
  {
    method: 'POST',
    path: '/reset-password',
    handle: (c, r) => handleResetPassword(c, r),
  },
  {
    method: 'POST',
    path: '/update-profile',
    handle: (c, r) => handleUpdateProfile(c, r),
  },
  {
    method: 'POST',
    path: '/change-password',
    handle: (c, r) => handleChangePassword(c, r),
  },
  {
    method: 'POST',
    path: '/permissions/check',
    handle: (c, r) => handlePermissionsCheck(c, r),
  },
  { method: 'GET', path: '/roles', handle: (c, r) => handleListRoles(c, r) },
  {
    method: 'GET',
    path: '/orgs/members',
    handle: (c, r) => handleListOrgMembers(c, r),
  },
  {
    method: 'POST',
    path: '/orgs/members/roles',
    handle: (c, r) => handleAssignOrgMemberRole(c, r),
  },
  {
    method: 'POST',
    path: '/sign-in/sso',
    handle: (c, r) => handleSignInSso(c, r),
  },
];

export function matchRolePermissionsPath(path: string): boolean {
  return path.startsWith('/roles/') && path.endsWith('/permissions');
}
