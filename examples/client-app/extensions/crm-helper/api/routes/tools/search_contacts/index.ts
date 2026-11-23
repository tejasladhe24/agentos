import {
  getSession,
  requireOrg,
  requirePermissions,
} from '@agentos/core/api/auth';
import { dbStore } from '@agentos/core/api/store';
import type { Middleware, RouteHandlers } from '@agentos/core/api';

export const middleware: Middleware[] = [
  requirePermissions('crm.read'),
  requireOrg,
];

type SearchInput = {
  q?: string;
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
};

export const POST: RouteHandlers['POST'] = async (c) => {
  const session = getSession(c)!;
  const input = (await c.req.json().catch(() => ({}))) as SearchInput;
  const result = await dbStore
    .collection('contacts', { orgId: session.orgId! })
    .query({
      where: input.where,
      limit: input.limit ?? 50,
      offset: input.offset,
    });

  const q = typeof input.q === 'string' ? input.q.trim().toLowerCase() : '';
  if (!q) {
    return c.json(result);
  }

  const items = result.items.filter((item) => {
    const name = String(item.data.name ?? '').toLowerCase();
    const email = String(item.data.email ?? '').toLowerCase();
    const company = String(item.data.company ?? '').toLowerCase();
    return name.includes(q) || email.includes(q) || company.includes(q);
  });

  return c.json({ items });
};
