import { requireOrg, getSession } from '@agentos/core/api/auth';
import { signPublicToken } from '@agentos/core/api/public-token';
import type { Middleware, RouteHandlers } from '@agentos/core/api';

export const middleware: Middleware[] = [requireOrg];

/**
 * Authenticated mint helper — creates a short-lived public portal link token
 * bound to the caller's active org.
 */
export const POST: RouteHandlers['POST'] = async (c) => {
  const session = getSession(c);
  const orgId = session?.orgId;
  if (!orgId) {
    return c.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    ttlSeconds?: number;
  };

  const token = await signPublicToken({
    orgId,
    extensionId: 'demo',
    purpose: 'portal',
    pathPrefix: '/portal/',
    ttlSeconds: body.ttlSeconds ?? 3600,
  });

  const origin = (
    Bun.env.AGENT_OS_GLOBAL_APP_ORIGIN ?? 'http://127.0.0.1:5173'
  ).replace(/\/$/, '');

  return c.json({
    token,
    url: `${origin}/p/demo?token=${encodeURIComponent(token)}`,
    orgId,
  });
};
