import {
  getSession,
  requireOrg,
  requirePermissions,
} from '@agentos/core/api/auth';
import { dbStore } from '@agentos/core/api/store';
import type { Middleware, RouteHandlers } from '@agentos/core/api';

export const middleware: Middleware[] = [
  requirePermissions('crm.write'),
  requireOrg,
];

type CreateDealInput = {
  id?: string;
  data?: Record<string, unknown>;
  name?: string;
  contactId?: string;
  amount?: number;
  stage?: string;
};

export const POST: RouteHandlers['POST'] = async (c) => {
  const session = getSession(c)!;
  const body = (await c.req.json().catch(() => ({}))) as CreateDealInput;
  const data: Record<string, unknown> =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? { ...body.data }
      : {
          name: body.name,
          contactId: body.contactId,
          amount: body.amount,
          stage: body.stage ?? 'qualified',
        };

  const doc = await dbStore
    .collection('deals', { orgId: session.orgId! })
    .insert({
      id: body.id,
      data,
    });

  return c.json(doc, { status: 201 });
};
