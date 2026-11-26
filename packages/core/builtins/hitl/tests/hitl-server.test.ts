import { describe, expect, test } from 'bun:test';

import { createApprovalsStore } from '@agentos/core/builtins/hitl/api/lib/approvals-store';
import type {
  Approval,
  ApprovalStatus,
  DbStoreClient,
} from '@agentos/core/builtins/hitl/api/lib/db-store-client';
import { handleHitlRequest } from '@agentos/core/builtins/hitl/api/lib/handle-request';
import { resolveSessionOrgId } from '@agentos/core/builtins/hitl/api/lib/resolve-org';

function mockDb(
  fail = false,
  backing = new Map<string, Approval>(),
): DbStoreClient & { backing: Map<string, Approval> } {
  return {
    backing,
    async insert(approval) {
      if (fail) throw new Error('connection refused');
      backing.set(approval.id, approval);
      return approval;
    },
    async query(status?: ApprovalStatus) {
      if (fail) throw new Error('connection refused');
      const all = [...backing.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      if (!status) return all;
      return all.filter((a) => a.status === status);
    },
    async get(id) {
      if (fail) throw new Error('connection refused');
      return backing.get(id);
    },
    async update(approval) {
      if (fail) throw new Error('connection refused');
      backing.set(approval.id, approval);
      return approval;
    },
  };
}

describe('builtin hitl server', () => {
  test('health OK; create → list → resolve', async () => {
    const store = createApprovalsStore(mockDb());

    const health = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/health'),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, backend: 'db-store' });

    const created = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Approve payout',
          body: '$100',
          metadata: { amount: 100 },
        }),
      }),
    );
    expect(created.status).toBe(201);
    const approval = (await created.json()) as {
      id: string;
      status: string;
      title: string;
    };
    expect(approval.status).toBe('pending');
    expect(approval.title).toBe('Approve payout');

    const listed = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals?status=pending'),
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { approvals: unknown[] };
    expect(listBody.approvals).toHaveLength(1);

    const resolved = await handleHitlRequest(
      store,
      new Request(`http://127.0.0.1:6114/approvals/${approval.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      id: approval.id,
      status: 'approved',
    });
  });

  test('bad create / missing / double resolve', async () => {
    const store = createApprovalsStore(mockDb());

    const bad = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(bad.status).toBe(400);

    const missing = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals/missing/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
    );
    expect(missing.status).toBe(404);

    const created = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Once' }),
      }),
    );
    const { id } = (await created.json()) as { id: string };

    await handleHitlRequest(
      store,
      new Request(`http://127.0.0.1:6114/approvals/${id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      }),
    );

    const again = await handleHitlRequest(
      store,
      new Request(`http://127.0.0.1:6114/approvals/${id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
    );
    expect(again.status).toBe(409);
  });

  test('create → restart → list / approve', async () => {
    const backing = new Map<string, Approval>();
    const storeA = createApprovalsStore(mockDb(false, backing));

    const created = await handleHitlRequest(
      storeA,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Survive restart' }),
      }),
    );
    const approval = (await created.json()) as { id: string };
    expect(created.status).toBe(201);

    // New process = new store over same durable backing.
    const storeB = createApprovalsStore(mockDb(false, backing));
    const listed = await handleHitlRequest(
      storeB,
      new Request('http://127.0.0.1:6114/approvals?status=pending'),
    );
    const listBody = (await listed.json()) as { approvals: Approval[] };
    expect(listBody.approvals).toHaveLength(1);
    expect(listBody.approvals[0]?.id).toBe(approval.id);

    const resolved = await handleHitlRequest(
      storeB,
      new Request(`http://127.0.0.1:6114/approvals/${approval.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      id: approval.id,
      status: 'approved',
    });
  });

  test('db-store down → 502', async () => {
    const store = createApprovalsStore(mockDb(true));
    const fail = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Nope' }),
      }),
    );
    expect(fail.status).toBe(502);
  });

  test('resolve publishes hitl.resolved', async () => {
    const store = createApprovalsStore(mockDb());
    const published: unknown[] = [];
    const created = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Ship it' }),
      }),
    );
    const { id } = (await created.json()) as { id: string };

    const resolved = await handleHitlRequest(
      store,
      new Request(`http://127.0.0.1:6114/approvals/${id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
      {
        publishResolved: async (payload) => {
          published.push(payload);
        },
      },
    );
    expect(resolved.status).toBe(200);
    expect(published).toEqual([
      {
        approvalId: id,
        decision: 'approved',
        title: 'Ship it',
        resolvedAt: expect.any(String),
      },
    ]);
  });

  test('GET /approvals/:id returns one approval, 404 when unknown', async () => {
    const store = createApprovalsStore(mockDb());
    const created = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Look me up' }),
      }),
    );
    const { id } = (await created.json()) as { id: string };

    const found = await handleHitlRequest(
      store,
      new Request(`http://127.0.0.1:6114/approvals/${id}`),
    );
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ id, status: 'pending' });

    const missing = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals/nope'),
    );
    expect(missing.status).toBe(404);

    const failing = await handleHitlRequest(
      createApprovalsStore(mockDb(true)),
      new Request(`http://127.0.0.1:6114/approvals/${id}`),
    );
    expect(failing.status).toBe(502);
  });

  test('events carry the caller org; create publishes hitl.requested', async () => {
    const store = createApprovalsStore(mockDb());
    const events: Array<[string, unknown, string | undefined]> = [];
    const options = {
      resolveOrgId: async () => 'org-a',
      publishRequested: async (payload: unknown, orgId?: string) => {
        events.push(['requested', payload, orgId]);
      },
      publishResolved: async (payload: unknown, orgId?: string) => {
        events.push(['resolved', payload, orgId]);
      },
    };
    const created = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Org scoped' }),
      }),
      options,
    );
    const { id } = (await created.json()) as { id: string };
    await handleHitlRequest(
      store,
      new Request(`http://127.0.0.1:6114/approvals/${id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      }),
      options,
    );
    expect(events).toEqual([
      ['requested', { approvalId: id, title: 'Org scoped' }, 'org-a'],
      [
        'resolved',
        expect.objectContaining({ approvalId: id, decision: 'rejected' }),
        'org-a',
      ],
    ]);
  });

  test('a failing org lookup or publisher never fails the request', async () => {
    const store = createApprovalsStore(mockDb());
    const created = await handleHitlRequest(
      store,
      new Request('http://127.0.0.1:6114/approvals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Resilient' }),
      }),
      {
        resolveOrgId: async () => {
          throw new Error('auth down');
        },
        publishRequested: async () => {
          throw new Error('events down');
        },
      },
    );
    expect(created.status).toBe(201);
  });
});

describe('resolveSessionOrgId', () => {
  const req = (cookie?: string) =>
    new Request('http://x/approvals', cookie ? { headers: { cookie } } : {});

  test('reads the org from the auth session and never trusts headers', async () => {
    const seen: Array<{ url: string; cookie: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({
        url,
        cookie: new Headers(init?.headers).get('cookie'),
      });
      return Response.json({ orgId: 'org-9' });
    }) as unknown as typeof fetch;
    expect(await resolveSessionOrgId(req('sid=1'), {}, fetchImpl)).toBe(
      'org-9',
    );
    expect(seen).toEqual([
      { url: 'http://127.0.0.1:6110/session', cookie: 'sid=1' },
    ]);
    expect(
      await resolveSessionOrgId(
        new Request('http://x', { headers: { 'x-agentos-org-id': 'evil' } }),
        {},
        fetchImpl,
      ),
    ).toBeUndefined();
  });

  test('is undefined on auth errors, non-OK and missing org', async () => {
    const mk = (impl: () => Promise<Response>) =>
      resolveSessionOrgId(req('sid=1'), {}, impl as unknown as typeof fetch);
    expect(await mk(async () => new Response('{}', { status: 401 }))).toBe(
      undefined,
    );
    expect(await mk(async () => Response.json({ orgId: null }))).toBe(
      undefined,
    );
    expect(
      await mk(async () => {
        throw new Error('down');
      }),
    ).toBeUndefined();
  });

  test('uses the gateway URL when configured', async () => {
    let target = '';
    const fetchImpl = (async (url: string) => {
      target = url;
      return Response.json({ orgId: 'o' });
    }) as unknown as typeof fetch;
    await resolveSessionOrgId(
      req('c=1'),
      { AGENT_OS_GLOBAL_GATEWAY_URL: 'http://gw/' },
      fetchImpl,
    );
    expect(target).toBe('http://gw/api/ext/auth/session');
  });
});
