import { ORG_ID_HEADER } from './constants';

const DEFAULT_AUTH_BASE = 'http://127.0.0.1:6110';

export type ResolveOrgResult =
  | { ok: true; orgId: string; via: 'session' | 'header'; orgName?: string }
  | { ok: false; status: number; error: string };

function resolveAuthApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  if (env.AGENT_OS_AUTH_API_BASE) {
    return env.AGENT_OS_AUTH_API_BASE.replace(/\/$/, '');
  }
  if (env.AGENT_OS_EXT_INBOUND_EMAIL_AUTH_API_BASE) {
    return env.AGENT_OS_EXT_INBOUND_EMAIL_AUTH_API_BASE.replace(/\/$/, '');
  }
  const gateway = env.AGENT_OS_GLOBAL_GATEWAY_URL?.replace(/\/$/, '');
  if (gateway) {
    return `${gateway}/api/ext/auth`;
  }
  return DEFAULT_AUTH_BASE;
}

async function orgIdFromSessionCookie(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<{ orgId: string; orgName?: string } | null | undefined> {
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
      orgs?: Array<{ id?: string; name?: string }>;
    };
    if (typeof body.orgId === 'string' && body.orgId.length > 0) {
      const orgName = body.orgs?.find((o) => o.id === body.orgId)?.name;
      return {
        orgId: body.orgId,
        ...(typeof orgName === 'string' && orgName ? { orgName } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve org for Email manager APIs: session cookie `orgId`, else `X-AgentOS-Org-Id`.
 */
export async function resolveOrgForInboundEmailRequest(
  request: Request,
  env: Record<string, string | undefined> = Bun.env,
): Promise<ResolveOrgResult> {
  const fromSession = await orgIdFromSessionCookie(request, env);
  if (fromSession) {
    return { ok: true, via: 'session', ...fromSession };
  }
  if (fromSession === null && request.headers.get('cookie')) {
    return { ok: false, status: 403, error: 'active org required' };
  }

  const header = request.headers.get(ORG_ID_HEADER)?.trim();
  if (header) {
    return { ok: true, orgId: header, via: 'header' };
  }

  return {
    ok: false,
    status: 401,
    error: 'org context required (session or X-AgentOS-Org-Id)',
  };
}
