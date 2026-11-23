import { getPublicAccess } from '@agentos/core/api/public-token';
import type { RouteHandlers } from '@agentos/core/api';

/**
 * Public portal probe — reachable without a session when a valid signed
 * token is presented (`Authorization: Bearer` or `?token=`).
 */
export const GET: RouteHandlers['GET'] = (c) => {
  const access = getPublicAccess(c);
  return c.json({
    ok: true,
    orgId: access?.orgId ?? null,
    purpose: access?.purpose ?? null,
  });
};
