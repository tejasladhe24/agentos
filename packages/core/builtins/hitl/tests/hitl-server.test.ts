import { describe, expect, test } from 'bun:test';

import { createApprovalsStore } from '@agentos/core/builtins/hitl/api/lib/approvals-store';
import type {
  Approval,
  ApprovalStatus,
  DbStoreClient,
} from '@agentos/core/builtins/hitl/api/lib/db-store-client';
import { handleHitlRequest } from '@agentos/core/builtins/hitl/api/lib/handle-request';

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
});
