import { EVENTS_ORG_HEADER } from '@agentos/core/api/events';

import { JOB_ADMIN_ROLES, PLATFORM_ORG_ID } from './constants';

const DEFAULT_AUTH_BASE = 'http://127.0.0.1:6110';

type EnvMap = Record<string, string | undefined>;

/**
 * Caller identity for an events request.
 * - `session`: browser (extension UI) with a signed-in user and an active org.
 * - `service`: an in-stack process holding the shared service token. `orgId`
 *   is the tenant it acts for, or `null` for platform scope / all orgs.
 */
export type EventsPrincipal =
  | {
      kind: 'session';
      orgId: string;
      userId: string;
      roles: readonly string[];
    }
  | { kind: 'service'; orgId: string | null };

export type AuthResult =
  | { ok: true; principal: EventsPrincipal }
  | { ok: false; status: 401 | 403; error: string };

export type EventsAuthenticator = (request: Request) => Promise<AuthResult>;

export type EventsAuthOptions = {
  /** Shared secret for service callers. Unset disables the service path. */
  serviceToken?: string;
  /** Builtin auth API base used to resolve the browser session. */
  authApiBase: string;
  fetchImpl?: typeof fetch;
};

/** Resolve the builtin auth API base (env override, gateway, then local). */
export function resolveAuthApiBase(env: EnvMap = Bun.env): string {
  if (env.AGENT_OS_AUTH_API_BASE) {
    return env.AGENT_OS_AUTH_API_BASE.replace(/\/$/, '');
  }
  const gateway = env.AGENT_OS_GLOBAL_GATEWAY_URL?.replace(/\/$/, '');
  if (gateway) return `${gateway}/api/ext/auth`;
  return DEFAULT_AUTH_BASE;
}

/** Constant-time string compare (avoids leaking the token via timing). */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function parseBearer(header: string): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/** Tenant a principal reads: its org, or `null` for every org (service only). */
export function readScope(principal: EventsPrincipal): string | null {
  return principal.orgId;
}

/** Tenant stamped on records a principal writes. */
export function writeOrgId(principal: EventsPrincipal): string {
  return principal.orgId ?? PLATFORM_ORG_ID;
}

/** Service callers manage jobs freely; sessions need an admin role. */
export function canManageJobs(principal: EventsPrincipal): boolean {
  if (principal.kind === 'service') return true;
  return principal.roles.some((role) => JOB_ADMIN_ROLES.has(role));
}

/**
 * Authenticate an events request.
 *
 * 1. `Authorization: Bearer <service token>` → service principal (the org it
 *    acts for comes from `x-agentos-org-id`; absent means platform scope).
 *    A wrong token is rejected outright; it never falls back to the cookie.
 * 2. Session cookie → `/session` on builtin auth; needs an active org.
 * 3. Anything else → 401.
 *
 * The org header is only honored on the service path. Through the gateway a
 * browser can send any header, so it must never be trusted for a session.
 */
export function createEventsAuthenticator(
  options: EventsAuthOptions,
): EventsAuthenticator {
  const serviceToken = options.serviceToken?.trim() || undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const authBase = options.authApiBase.replace(/\/$/, '');

  return async (request) => {
    const presented = parseBearer(request.headers.get('authorization') ?? '');
    if (presented) {
      if (!serviceToken || !safeEqual(presented, serviceToken)) {
        return { ok: false, status: 401, error: 'invalid service credential' };
      }
      const org = request.headers.get(EVENTS_ORG_HEADER)?.trim();
      return {
        ok: true,
        principal: { kind: 'service', orgId: org || null },
      };
    }

    const cookie = request.headers.get('cookie');
    if (!cookie) {
      return { ok: false, status: 401, error: 'unauthenticated' };
    }

    let res: Response;
    try {
      res = await fetchImpl(`${authBase}/session`, {
        method: 'GET',
        headers: { cookie },
      });
    } catch {
      return { ok: false, status: 401, error: 'unauthenticated' };
    }
    if (!res.ok) {
      return { ok: false, status: 401, error: 'unauthenticated' };
    }

    let body: {
      user?: { id?: unknown } | null;
      roles?: unknown;
      orgId?: unknown;
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { ok: false, status: 401, error: 'unauthenticated' };
    }

    const userId = typeof body.user?.id === 'string' ? body.user.id : '';
    if (!userId) {
      return { ok: false, status: 401, error: 'unauthenticated' };
    }
    if (typeof body.orgId !== 'string' || body.orgId.length === 0) {
      return { ok: false, status: 403, error: 'active org required' };
    }
    const roles = Array.isArray(body.roles)
      ? body.roles.filter((r): r is string => typeof r === 'string')
      : [];
    return {
      ok: true,
      principal: { kind: 'session', orgId: body.orgId, userId, roles },
    };
  };
}
