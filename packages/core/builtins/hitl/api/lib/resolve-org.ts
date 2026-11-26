type Env = Record<string, string | undefined>;

const DEFAULT_AUTH_BASE = 'http://127.0.0.1:6110';

function authApiBase(env: Env): string {
  if (env.AGENT_OS_AUTH_API_BASE) {
    return env.AGENT_OS_AUTH_API_BASE.replace(/\/$/, '');
  }
  const gateway = env.AGENT_OS_GLOBAL_GATEWAY_URL?.replace(/\/$/, '');
  if (gateway) return `${gateway}/api/ext/auth`;
  return DEFAULT_AUTH_BASE;
}

/**
 * Org of the signed-in caller, from the session cookie only (never a
 * client-supplied header). Used to scope `hitl.*` events so browser sessions
 * in that org receive them; `undefined` leaves the event platform-scoped.
 */
export async function resolveSessionOrgId(
  request: Request,
  env: Env = Bun.env,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  try {
    const res = await fetchImpl(`${authApiBase(env)}/session`, {
      headers: { cookie },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { orgId?: unknown };
    return typeof body.orgId === 'string' && body.orgId
      ? body.orgId
      : undefined;
  } catch {
    return undefined;
  }
}
