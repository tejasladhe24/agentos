/**
 * @agentos/core/api/auth — session + RBAC kit for FDE routes (ticket 21).
 * Builtin HTTP contract lives at `/api/ext/auth/*` (packages/core/builtins/auth).
 * No separate /api/rbac.
 */

import type { AppContext, Middleware, Next } from './types';

/** Org membership entry on session / list responses. */
export type AuthOrgMembership = {
  id: string;
  name: string;
  role: string;
};

/** Session payload returned by builtin `GET /session` / `/me`. */
export type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  session: {
    id: string;
    expiresAt: string | Date;
  };
  roles: string[];
  /** Active organization id, or null when the user has no memberships. */
  orgId: string | null;
  orgs: AuthOrgMembership[];
};

const SESSION_KEY = 'auth.session';

const DEFAULT_GATEWAY = 'http://127.0.0.1:5173';

/** Resolve builtin auth API base (`…/api/ext/auth` or test override). */
export function resolveAuthApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  if (env.AGENT_OS_AUTH_API_BASE) {
    return env.AGENT_OS_AUTH_API_BASE.replace(/\/$/, '');
  }
  const gateway = (env.AGENT_OS_GLOBAL_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(
    /\/$/,
    '',
  );
  return `${gateway}/api/ext/auth`;
}

function unauthenticated(c: AppContext): Response {
  return c.json({ error: 'unauthenticated' }, { status: 401 });
}

function forbidden(c: AppContext): Response {
  return c.json({ error: 'forbidden' }, { status: 403 });
}

function forwardCookieHeaders(from: Headers): Headers {
  const headers = new Headers();
  const cookie = from.get('cookie');
  if (cookie) {
    headers.set('cookie', cookie);
  }
  return headers;
}

async function fetchSession(
  c: AppContext,
  base: string,
): Promise<AuthSession | null> {
  const res = await fetch(`${base}/session`, {
    method: 'GET',
    headers: forwardCookieHeaders(c.req.headers),
  });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as AuthSession;
  if (!body?.user?.id) {
    return null;
  }
  return body;
}

async function checkPermission(
  c: AppContext,
  base: string,
  permission: string,
): Promise<'unauthenticated' | 'allowed' | 'denied'> {
  const res = await fetch(`${base}/permissions/check`, {
    method: 'POST',
    headers: (() => {
      const h = forwardCookieHeaders(c.req.headers);
      h.set('content-type', 'application/json');
      return h;
    })(),
    body: JSON.stringify({ permission }),
  });
  if (res.status === 401) {
    return 'unauthenticated';
  }
  if (!res.ok) {
    return 'denied';
  }
  const body = (await res.json()) as { allowed?: boolean };
  return body.allowed === true ? 'allowed' : 'denied';
}

async function ensureSession(
  c: AppContext,
  base: string,
): Promise<AuthSession | Response> {
  const existing = c.get<AuthSession>(SESSION_KEY);
  if (existing) {
    return existing;
  }
  const session = await fetchSession(c, base);
  if (!session) {
    return unauthenticated(c);
  }
  c.set(SESSION_KEY, session);
  return session;
}

/** Read session stashed by auth middleware (if any). */
export function getSession(c: AppContext): AuthSession | undefined {
  return c.get<AuthSession>(SESSION_KEY);
}

/**
 * Require an authenticated session. Stashes `AuthSession` on context.
 * Returns 401 when builtin auth has no session.
 */
export const requireSession: Middleware = async (c, next) => {
  const base = resolveAuthApiBase();
  const sessionOrErr = await ensureSession(c, base);
  if (sessionOrErr instanceof Response) {
    return sessionOrErr;
  }
  return next();
};

/**
 * Require every listed role on the session. Includes session check (401/403).
 */
export function requireRoles(...roles: string[]): Middleware {
  return async (c: AppContext, next: Next) => {
    const base = resolveAuthApiBase();
    const sessionOrErr = await ensureSession(c, base);
    if (sessionOrErr instanceof Response) {
      return sessionOrErr;
    }
    const have = new Set(sessionOrErr.roles);
    for (const role of roles) {
      if (!have.has(role)) {
        return forbidden(c);
      }
    }
    return next();
  };
}

/**
 * Require an authenticated session with a non-null active `orgId`.
 * Returns 401 when unauthenticated, 403 when no active org.
 */
export const requireOrg: Middleware = async (c, next) => {
  const base = resolveAuthApiBase();
  const sessionOrErr = await ensureSession(c, base);
  if (sessionOrErr instanceof Response) {
    return sessionOrErr;
  }
  if (!sessionOrErr.orgId) {
    return forbidden(c);
  }
  return next();
};

/**
 * Require every listed permission via builtin `/permissions/check`.
 * Includes session check (401/403). Safe as sole middleware entry.
 */
export function requirePermissions(...permissions: string[]): Middleware {
  return async (c: AppContext, next: Next) => {
    const base = resolveAuthApiBase();
    const sessionOrErr = await ensureSession(c, base);
    if (sessionOrErr instanceof Response) {
      return sessionOrErr;
    }
    for (const permission of permissions) {
      const result = await checkPermission(c, base, permission);
      if (result === 'unauthenticated') {
        return unauthenticated(c);
      }
      if (result === 'denied') {
        return forbidden(c);
      }
    }
    return next();
  };
}
