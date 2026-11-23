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

  afterAll(() => {
    ctx?.close();
  });
});
