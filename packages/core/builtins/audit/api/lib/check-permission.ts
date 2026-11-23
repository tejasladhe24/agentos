const DEFAULT_AUTH_BASE = 'http://127.0.0.1:6110';

export type PermissionResult = 'ok' | 'unauthenticated' | 'denied';

function resolveAuthApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  if (env.AGENT_OS_AUTH_API_BASE) {
    return env.AGENT_OS_AUTH_API_BASE.replace(/\/$/, '');
  }
  if (env.AGENT_OS_EXT_AUDIT_AUTH_API_BASE) {
    return env.AGENT_OS_EXT_AUDIT_AUTH_API_BASE.replace(/\/$/, '');
  }
  const gateway = env.AGENT_OS_GLOBAL_GATEWAY_URL?.replace(/\/$/, '');
  if (gateway) {
    return `${gateway}/api/ext/auth`;
  }
  return DEFAULT_AUTH_BASE;
}

/**
 * Check a permission via builtin auth `/permissions/check`.
 * Cookie session required; peer header-only callers skip this (trusted).
 */
export async function checkAuditPermission(
  request: Request,
  permission: string,
  env: Record<string, string | undefined> = Bun.env,
): Promise<PermissionResult> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return 'unauthenticated';

  const base = resolveAuthApiBase(env);
  try {
    const res = await fetch(`${base}/permissions/check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ permission }),
    });
    if (res.status === 401) return 'unauthenticated';
    if (!res.ok) return 'denied';
    const body = (await res.json()) as { allowed?: boolean };
    return body.allowed === true ? 'ok' : 'denied';
  } catch {
    return 'denied';
  }
}
