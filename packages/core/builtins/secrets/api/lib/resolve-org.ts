import { ORG_ID_HEADER, USER_ID_HEADER } from './constants';

const DEFAULT_AUTH_BASE = 'http://127.0.0.1:6110';

export type ResolveOrgResult =
  | {
      ok: true;
      orgId: string;
      via: 'session' | 'header';
      /** Session user, or peer `X-AgentOS-User-Id` (acting-for user). */
      userId?: string;
    }
  | { ok: false; status: number; error: string };

function resolveAuthApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  if (env.AGENT_OS_AUTH_API_BASE) {
    return env.AGENT_OS_AUTH_API_BASE.replace(/\/$/, '');
  }
  if (env.AGENT_OS_EXT_SECRETS_AUTH_API_BASE) {
    return env.AGENT_OS_EXT_SECRETS_AUTH_API_BASE.replace(/\/$/, '');
  }
  const gateway = env.AGENT_OS_GLOBAL_GATEWAY_URL?.replace(/\/$/, '');
  if (gateway) {
    return `${gateway}/api/ext/auth`;
  }
  return DEFAULT_AUTH_BASE;
}

type SessionIdentity = { orgId: string; userId?: string };

async function identityFromSessionCookie(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<SessionIdentity | null | undefined> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;

  const base = resolveAuthApiBase(env);
  try {
    const res = await fetch(`${base}/session`, {
      method: 'GET',
      headers: { cookie },
    });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as {
      orgId?: string | null;
      user?: { id?: string } | null;
    };
    if (typeof body.orgId === 'string' && body.orgId.length > 0) {
      const userId = body.user?.id;
      return typeof userId === 'string' && userId
        ? { orgId: body.orgId, userId }
        : { orgId: body.orgId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve org for vault ops: session cookie `orgId`, else `X-AgentOS-Org-Id`.
 * Env-only GET (no vault) does not require org.
 */
export async function resolveOrgForSecretsRequest(
  request: Request,
  env: Record<string, string | undefined> = Bun.env,
): Promise<ResolveOrgResult> {
  const fromSession = await identityFromSessionCookie(request, env);
  if (fromSession) {
    return { ok: true, ...fromSession, via: 'session' };
  }
  if (fromSession === null && request.headers.get('cookie')) {
    return { ok: false, status: 403, error: 'active org required' };
  }

  const header = request.headers.get(ORG_ID_HEADER)?.trim();
  if (header) {
    const userId = request.headers.get(USER_ID_HEADER)?.trim();
    return userId
      ? { ok: true, orgId: header, via: 'header', userId }
      : { ok: true, orgId: header, via: 'header' };
  }

  return {
    ok: false,
    status: 401,
    error: 'org context required (session or X-AgentOS-Org-Id)',
  };
}
