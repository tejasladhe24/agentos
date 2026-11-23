import { afterAll, describe, expect, test } from 'bun:test';

import { ORG_ID_HEADER } from '@agentos/core/builtins/db-store/api/lib/constants';
import { createDb } from '@agentos/core/builtins/db-store/api/lib/create-db';
import { handleDbStoreRequest } from '@agentos/core/builtins/db-store/api/lib/handle-request';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function orgHeaders(orgId: string): HeadersInit {
  return {
    'content-type': 'application/json',
    [ORG_ID_HEADER]: orgId,
  };
}

describe('builtin db-store server', () => {
  let ctx: Awaited<ReturnType<typeof createDb>>;

  test('boots with in-memory sqlite and health OK', async () => {
    ctx = await createDb({ databasePath: ':memory:' });
    expect(ctx.dialect).toBe('sqlite');

    const health = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/health'),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, dialect: 'sqlite' });
  });

  test('tenant collection without org context → 401', async () => {
    const res = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  test('insert → query → update → delete collection docs', async () => {
    const insert = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'c1',
          data: { name: 'Ada', city: 'London' },
        }),
      }),
    );
    expect(insert.status).toBe(201);
    const inserted = (await insert.json()) as {
      id: string;
      data: { name: string; orgId: string };
    };
    expect(inserted.id).toBe('c1');
    expect(inserted.data.name).toBe('Ada');
    expect(inserted.data.orgId).toBe(ORG_A);

    await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          data: { name: 'Grace', city: 'London' },
        }),
      }),
    );

    const query = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ where: { city: 'London' } }),
      }),
    );
    expect(query.status).toBe(200);
    const queried = (await query.json()) as { items: Array<{ id: string }> };
    expect(queried.items.length).toBe(2);

    const update = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/update', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'c1',
          data: { title: 'Countess' },
          merge: true,
        }),
      }),
    );
    expect(update.status).toBe(200);
    const updated = (await update.json()) as {
      data: { name: string; title: string; city: string; orgId: string };
    };
    expect(updated.data.name).toBe('Ada');
    expect(updated.data.title).toBe('Countess');
    expect(updated.data.city).toBe('London');
    expect(updated.data.orgId).toBe(ORG_A);

    const del = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/delete', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ id: 'c1' }),
      }),
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: 1 });

    const after = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({}),
      }),
    );
    const afterBody = (await after.json()) as { items: Array<{ id: string }> };
    expect(afterBody.items.every((i) => i.id !== 'c1')).toBe(true);
  });

  test('org A cannot read org B docs', async () => {
    const insertB = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/secrets/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_B),
        body: JSON.stringify({
          id: 'secret-1',
          data: { value: 'tenant-b-only' },
        }),
      }),
    );
    expect(insertB.status).toBe(201);

    const queryA = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/secrets/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({}),
      }),
    );
    expect(queryA.status).toBe(200);
    const bodyA = (await queryA.json()) as {
      items: Array<{ id: string; data: { value?: string } }>;
    };
    expect(bodyA.items.every((i) => i.id !== 'secret-1')).toBe(true);

    const updateA = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/secrets/update', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'secret-1',
          data: { value: 'hacked' },
        }),
      }),
    );
    expect(updateA.status).toBe(404);

    const queryB = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/secrets/query', {
        method: 'POST',
        headers: orgHeaders(ORG_B),
        body: JSON.stringify({}),
      }),
    );
    const bodyB = (await queryB.json()) as {
      items: Array<{ id: string; data: { value: string } }>;
    };
    expect(bodyB.items.some((i) => i.id === 'secret-1')).toBe(true);
    expect(bodyB.items.find((i) => i.id === 'secret-1')?.data.value).toBe(
      'tenant-b-only',
    );
  });

  test('same document id allowed in different orgs', async () => {
    const a = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/shared-ids/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ id: 'same', data: { owner: 'A' } }),
      }),
    );
    const b = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/shared-ids/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_B),
        body: JSON.stringify({ id: 'same', data: { owner: 'B' } }),
      }),
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  test('platform collection works without org header', async () => {
    const insert = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/agentos_gateway/insert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'extension-enable',
          data: { enabledById: {} },
        }),
      }),
    );
    expect(insert.status).toBe(201);

    const query = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/agentos_gateway/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(query.status).toBe(200);
    const body = (await query.json()) as { items: Array<{ id: string }> };
    expect(body.items.some((i) => i.id === 'extension-enable')).toBe(true);
  });

  test('duplicate insert → 409; missing update → 404; bad where → 400', async () => {
    const dup = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'c1',
          data: { name: 'again' },
        }),
      }),
    );
    // c1 was deleted; re-insert then duplicate
    expect(dup.status).toBe(201);

    const dup2 = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'c1',
          data: { name: 'again' },
        }),
      }),
    );
    expect(dup2.status).toBe(409);

    const missing = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/update', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'missing',
          data: { name: 'x' },
        }),
      }),
    );
    expect(missing.status).toBe(404);

    const badWhere = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/contacts/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ where: { $gt: { age: 1 } } }),
      }),
    );
    expect(badWhere.status).toBe(400);
  });

  test('insert-bulk all-or-nothing and size cap', async () => {
    const ok = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snapshots/insert-bulk', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          docs: [
            { id: 's1', data: { targetId: 't1', price: 10 } },
            { id: 's2', data: { targetId: 't1', price: 11 } },
          ],
        }),
      }),
    );
    expect(ok.status).toBe(201);
    const okBody = (await ok.json()) as { items: Array<{ id: string }> };
    expect(okBody.items.map((i) => i.id).sort()).toEqual(['s1', 's2']);

    const conflict = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snapshots/insert-bulk', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          docs: [
            { id: 's1', data: { price: 99 } },
            { id: 's3', data: { price: 12 } },
          ],
        }),
      }),
    );
    expect(conflict.status).toBe(409);

    const afterConflict = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snapshots/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({}),
      }),
    );
    const afterBody = (await afterConflict.json()) as {
      items: Array<{ id: string }>;
    };
    expect(afterBody.items.some((i) => i.id === 's3')).toBe(false);

    const tooMany = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snapshots/insert-bulk', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          docs: Array.from({ length: 101 }, (_, i) => ({
            data: { n: i },
          })),
        }),
      }),
    );
    expect(tooMany.status).toBe(400);
  });

  test('retention maxCount + TTL prune; org isolation', async () => {
    const setPolicy = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snap_hist/retention', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ maxCount: 2, maxCountGroupBy: 'targetId' }),
      }),
    );
    expect(setPolicy.status).toBe(201);

    const bulk = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snap_hist/insert-bulk', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          docs: [
            { id: 'a1', data: { targetId: 't1', n: 1 } },
            { id: 'a2', data: { targetId: 't1', n: 2 } },
            { id: 'a3', data: { targetId: 't1', n: 3 } },
            { id: 'b1', data: { targetId: 't2', n: 1 } },
          ],
        }),
      }),
    );
    expect(bulk.status).toBe(201);

    const listed = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snap_hist/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ sort: { createdAt: 'desc' } }),
      }),
    );
    const listedBody = (await listed.json()) as {
      items: Array<{ id: string; data: { targetId: string } }>;
    };
    const t1 = listedBody.items.filter((i) => i.data.targetId === 't1');
    expect(t1.length).toBe(2);
    expect(listedBody.items.some((i) => i.id === 'b1')).toBe(true);

    // Org B docs untouched by org A prune/policy
    await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snap_hist/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_B),
        body: JSON.stringify({ id: 'b-only', data: { targetId: 't9', n: 1 } }),
      }),
    );
    const pruneA = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snap_hist/prune', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({}),
      }),
    );
    expect(pruneA.status).toBe(200);
    const queryB = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/snap_hist/query', {
        method: 'POST',
        headers: orgHeaders(ORG_B),
        body: JSON.stringify({}),
      }),
    );
    const bodyB = (await queryB.json()) as { items: Array<{ id: string }> };
    expect(bodyB.items.some((i) => i.id === 'b-only')).toBe(true);

    // Per-doc expiresAt
    await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/ttl_docs/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'old',
          data: { expiresAt: '2000-01-01T00:00:00.000Z' },
        }),
      }),
    );
    await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/ttl_docs/insert', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          id: 'fresh',
          data: { expiresAt: '2099-01-01T00:00:00.000Z' },
        }),
      }),
    );
    const prunedTtl = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/ttl_docs/prune', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({}),
      }),
    );
    expect(prunedTtl.status).toBe(200);
    expect(await prunedTtl.json()).toEqual({ deleted: 1 });
    const ttlQuery = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/ttl_docs/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({}),
      }),
    );
    const ttlBody = (await ttlQuery.json()) as { items: Array<{ id: string }> };
    expect(ttlBody.items.map((i) => i.id)).toEqual(['fresh']);
  });

  test('query operators, sort, limit, offset', async () => {
    const seed = [
      { id: 't1', data: { amount: 10, status: 'open', day: '2026-01-01' } },
      { id: 't2', data: { amount: 25, status: 'open', day: '2026-01-15' } },
      { id: 't3', data: { amount: 40, status: 'held', day: '2026-02-01' } },
      { id: 't4', data: { amount: 5, status: 'open', day: '2025-12-01' } },
    ];
    for (const row of seed) {
      const res = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/txns/insert', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify(row),
        }),
      );
      expect(res.status).toBe(201);
    }

    const ranged = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/txns/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          where: {
            amount: { $gte: 10, $lt: 40 },
            status: { $in: ['open'] },
          },
          sort: { amount: 'desc' },
        }),
      }),
    );
    expect(ranged.status).toBe(200);
    const rangedBody = (await ranged.json()) as {
      items: Array<{ id: string }>;
    };
    expect(rangedBody.items.map((i) => i.id)).toEqual(['t2', 't1']);

    const paged = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/txns/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({
          sort: { amount: 'asc' },
          limit: 2,
          offset: 1,
        }),
      }),
    );
    expect(paged.status).toBe(200);
    const pagedBody = (await paged.json()) as { items: Array<{ id: string }> };
    expect(pagedBody.items.map((i) => i.id)).toEqual(['t1', 't2']);

    const unknownOp = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/txns/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ where: { amount: { $regex: 'x' } } }),
      }),
    );
    expect(unknownOp.status).toBe(400);

    const badSort = await handleDbStoreRequest(
      ctx,
      new Request('http://127.0.0.1:6111/collections/txns/query', {
        method: 'POST',
        headers: orgHeaders(ORG_A),
        body: JSON.stringify({ sort: { amount: 'upward' } }),
      }),
    );
    expect(badSort.status).toBe(400);
  });

  test('org retention default TTL + legal hold blocks prune and subject delete', async () => {
    const originalFetch = globalThis.fetch;
    const auditCalls: unknown[] = [];
    const deletedKeys: string[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input);
      if (url.includes('/api/ext/audit/entries') || url.includes('/entries')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        auditCalls.push(body);
        return Response.json(
          {
            id: 'audit-1',
            ...body,
            at: '2026-01-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }
      if (
        (url.includes('/blobs/') || url.includes('/api/ext/files/')) &&
        (init?.method ?? 'GET').toUpperCase() === 'DELETE'
      ) {
        const key = decodeURIComponent(url.split('/blobs/')[1] ?? '');
        deletedKeys.push(key);
        return Response.json({ ok: true, key });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      Bun.env.AGENT_OS_AUDIT_API_BASE = 'http://audit.test';
      Bun.env.AGENT_OS_FILES_API_BASE = 'http://files.test';

      const setOrg = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/org-retention', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            defaultTtlSeconds: 60,
            legalHold: false,
            optedInCollections: ['cand_notes'],
          }),
        }),
      );
      expect(setOrg.status).toBe(201);

      await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/insert', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            id: 'n1',
            data: {
              email: 'ada@example.com',
              name: 'Ada',
              expiresAt: '2000-01-01T00:00:00.000Z',
            },
          }),
        }),
      );
      await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/insert', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            id: 'n2',
            data: { email: 'grace@example.com', name: 'Grace' },
          }),
        }),
      );

      const pruned = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/prune', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({}),
        }),
      );
      expect(pruned.status).toBe(200);
      expect(await pruned.json()).toEqual({ deleted: 1 });

      await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/insert', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            id: 'n3',
            data: { email: 'ada@example.com', name: 'Ada again' },
          }),
        }),
      );

      const deleted = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/subjects/delete', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            subjectId: 'ada@example.com',
            mode: 'delete',
            collections: [
              { name: 'cand_notes', where: { email: 'ada@example.com' } },
            ],
            fileKeys: ['resumes/ada.pdf'],
            actor: 'admin@agency.test',
          }),
        }),
      );
      expect(deleted.status).toBe(200);
      const deletedBody = (await deleted.json()) as {
        collections: Array<{ deleted: number }>;
        files: Array<{ key: string; ok: boolean }>;
        auditId?: string;
      };
      expect(deletedBody.collections[0]?.deleted).toBe(1);
      expect(deletedBody.files).toEqual([{ key: 'resumes/ada.pdf', ok: true }]);
      expect(deletedBody.auditId).toBe('audit-1');
      expect(deletedKeys).toEqual(['resumes/ada.pdf']);
      expect(auditCalls).toHaveLength(1);

      const anonymizeSeed = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/insert', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            id: 'n4',
            data: { email: 'anon@example.com', phone: '555' },
          }),
        }),
      );
      expect(anonymizeSeed.status).toBe(201);

      const anonymized = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/subjects/delete', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            subjectId: 'anon@example.com',
            mode: 'anonymize',
            collections: [
              {
                name: 'cand_notes',
                where: { email: 'anon@example.com' },
                anonymizeFields: ['email', 'phone'],
              },
            ],
          }),
        }),
      );
      expect(anonymized.status).toBe(200);
      const listed = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/query', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({}),
        }),
      );
      const listedBody = (await listed.json()) as {
        items: Array<{ id: string; data: Record<string, unknown> }>;
      };
      const n4 = listedBody.items.find((i) => i.id === 'n4');
      expect(n4?.data.email).toBe('[redacted]');
      expect(n4?.data.phone).toBe('[redacted]');

      const hold = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/org-retention', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            legalHold: true,
            holdReason: 'litigation',
            defaultTtlSeconds: 60,
            optedInCollections: ['cand_notes'],
          }),
        }),
      );
      expect(hold.status).toBe(201);

      const pruneHeld = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/prune', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({}),
        }),
      );
      expect(pruneHeld.status).toBe(423);

      const deleteHeld = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/subjects/delete', {
          method: 'POST',
          headers: orgHeaders(ORG_A),
          body: JSON.stringify({
            subjectId: 'grace@example.com',
            mode: 'delete',
            collections: [
              { name: 'cand_notes', where: { email: 'grace@example.com' } },
            ],
          }),
        }),
      );
      expect(deleteHeld.status).toBe(423);

      // Org B not held
      await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/collections/cand_notes/insert', {
          method: 'POST',
          headers: orgHeaders(ORG_B),
          body: JSON.stringify({
            id: 'b1',
            data: { email: 'bob@example.com' },
          }),
        }),
      );
      const deleteB = await handleDbStoreRequest(
        ctx,
        new Request('http://127.0.0.1:6111/subjects/delete', {
          method: 'POST',
          headers: orgHeaders(ORG_B),
          body: JSON.stringify({
            subjectId: 'bob@example.com',
            collections: [
              { name: 'cand_notes', where: { email: 'bob@example.com' } },
            ],
          }),
        }),
      );
      expect(deleteB.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
      delete Bun.env.AGENT_OS_AUDIT_API_BASE;
      delete Bun.env.AGENT_OS_FILES_API_BASE;
    }
  });

  afterAll(() => {
    ctx?.close();
  });
});
