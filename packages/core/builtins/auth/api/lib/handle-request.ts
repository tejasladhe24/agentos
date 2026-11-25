import type { AuthContext } from './create-auth';
import { json } from './http';
import {
  AUTH_EXACT_ROUTES,
  handleDeleteOrg,
  handleDeleteRole,
  handleRevokeOrgInvite,
  handleSetRolePermissions,
  handleUpdateOrg,
  matchOrgIdPath,
  matchOrgInvitePath,
  matchRolePath,
  matchRolePermissionsPath,
} from './routes';
import { isBetterAuthForwardPath } from './sso-config';

/** Rewrite Bun-root SSO paths onto Better Auth's handler URL space. */
function toBetterAuthRequest(request: Request): Request {
  const url = new URL(request.url);
  // basePath is `/` — forward as-is
  return new Request(url, request);
}

/**
 * Thin Bun request router for `/api/ext/auth/*` upstream paths.
 * Exact routes live in `routes.ts`; SSO plugin paths forward to Better Auth.
 */
export async function handleAuthRequest(
  ctx: AuthContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  for (const route of AUTH_EXACT_ROUTES) {
    if (route.method === method && route.path === path) {
      return route.handle(ctx, request, path);
    }
  }

  if (method === 'PUT' && matchRolePermissionsPath(path)) {
    return handleSetRolePermissions(ctx, request, path);
  }

  if (method === 'DELETE' && matchRolePath(path)) {
    return handleDeleteRole(ctx, request, path);
  }

  if (method === 'PATCH' && matchOrgIdPath(path)) {
    return handleUpdateOrg(ctx, request, path);
  }

  if (method === 'DELETE' && matchOrgIdPath(path)) {
    return handleDeleteOrg(ctx, request, path);
  }

  if (method === 'DELETE' && matchOrgInvitePath(path)) {
    return handleRevokeOrgInvite(ctx, request, path);
  }

  if (isBetterAuthForwardPath(path)) {
    return ctx.auth.handler(toBetterAuthRequest(request));
  }

  return json({ error: 'not found' }, { status: 404 });
}
