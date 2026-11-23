import { describe, expect, test } from 'bun:test';

import { ORG_ID_HEADER } from '@agentos/core/builtins/vector-store/api/lib/constants';
import { createVectorStore } from '@agentos/core/builtins/vector-store/api/lib/create-store';
import { handleVectorStoreRequest } from '@agentos/core/builtins/vector-store/api/lib/handle-request';
import type { ResolveOrgResult } from '@agentos/core/builtins/vector-store/api/lib/resolve-org';
import { VectorStoreError } from '@agentos/core/builtins/vector-store/api/lib/vector-store-error';

const DIM = 4;

function unit(i: number): number[] {
  const v = [0, 0, 0, 0];
  v[i % DIM] = 1;
  return v;
}

function orgRequest(
  method: string,
  path: string,
  orgId: string,
  body?: unknown,
): Request {
  return new Request(`http://127.0.0.1:6120${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      [ORG_ID_HEADER]: orgId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('builtin vector-store (memory)', () => {
  test('health, upsert, query, delete with org isolation', async () => {
    const store = await createVectorStore({ mode: 'memory', dimensions: DIM });
    const resolveOrg = async (request: Request): Promise<ResolveOrgResult> => {
      const orgId = request.headers.get(ORG_ID_HEADER)?.trim();
      if (!orgId) return { ok: false, status: 401, error: 'org required' };
      return { ok: true, orgId };
    };
    const handle = (req: Request) =>
      handleVectorStoreRequest({ store, resolveOrg }, req);

    const health = await handle(new Request('http://127.0.0.1:6120/health'));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      mode: 'memory',
      dimensions: DIM,
    });

    const upsertA = await handle(
      orgRequest('POST', '/indexes/policies/upsert', 'org_a', {
        items: [
          {
            id: 'c1',
            embedding: unit(0),
            content: 'access control',
            metadata: { sourceId: 's1', page: 1 },
          },
          {
            id: 'c2',
            embedding: unit(1),
            content: 'encryption',
            metadata: { sourceId: 's1', page: 2 },
          },
        ],
      }),
    );
    expect(upsertA.status).toBe(200);
    expect(await upsertA.json()).toEqual({ upserted: 2 });

    await handle(
      orgRequest('POST', '/indexes/policies/upsert', 'org_b', {
        items: [
          {
            id: 'c1',
            embedding: unit(0),
            content: 'other tenant',
            metadata: { sourceId: 'x' },
          },
        ],
      }),
    );

    const queryA = await handle(
      orgRequest('POST', '/indexes/policies/query', 'org_a', {
        embedding: unit(0),
        topK: 2,
      }),
    );
    expect(queryA.status).toBe(200);
    const hitsA = (await queryA.json()) as {
      items: Array<{ id: string; content?: string; score: number }>;
    };
    expect(hitsA.items[0]?.id).toBe('c1');
    expect(hitsA.items[0]?.content).toBe('access control');
    expect(hitsA.items[0]!.score).toBeGreaterThan(0.9);

    const filtered = await handle(
      orgRequest('POST', '/indexes/policies/query', 'org_a', {
        embedding: unit(0),
        topK: 5,
        filter: { page: 2 },
      }),
    );
    const filteredHits = (await filtered.json()) as {
      items: Array<{ id: string }>;
    };
    expect(filteredHits.items.map((h) => h.id)).toEqual(['c2']);

    const queryB = await handle(
      orgRequest('POST', '/indexes/policies/query', 'org_b', {
        embedding: unit(0),
        topK: 5,
      }),
    );
    const hitsB = (await queryB.json()) as {
      items: Array<{ id: string; content?: string }>;
    };
    expect(hitsB.items).toHaveLength(1);
    expect(hitsB.items[0]?.content).toBe('other tenant');

    const del = await handle(
      orgRequest('POST', '/indexes/policies/delete', 'org_a', {
        ids: ['c1', 'c2'],
      }),
    );
    expect(await del.json()).toEqual({ deleted: 2 });

    const empty = await handle(
      orgRequest('POST', '/indexes/policies/query', 'org_a', {
        embedding: unit(0),
      }),
    );
    expect(await empty.json()).toEqual({ items: [] });
  });

  test('rejects missing org, bad dimension, invalid index', async () => {
    const store = await createVectorStore({ mode: 'memory', dimensions: DIM });
    const handle = (req: Request) => handleVectorStoreRequest({ store }, req);

    const noOrg = await handle(
      new Request('http://127.0.0.1:6120/indexes/policies/upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: 'x', embedding: unit(0) }],
        }),
      }),
    );
    expect(noOrg.status).toBe(401);

    const badDim = await handle(
      orgRequest('POST', '/indexes/policies/upsert', 'org_a', {
        items: [{ id: 'x', embedding: [1, 2] }],
      }),
    );
    expect(badDim.status).toBe(400);
    const badDimBody = (await badDim.json()) as { error: string };
    expect(badDimBody.error).toMatch(/dimensions/i);

    const badIndex = await handle(
      orgRequest('POST', '/indexes/-bad/upsert', 'org_a', {
        items: [{ id: 'x', embedding: unit(0) }],
      }),
    );
    expect(badIndex.status).toBe(400);
  });

  test('pgvector mode without URL returns clear error', async () => {
    await expect(
      createVectorStore({ mode: 'pgvector', dimensions: DIM }),
    ).rejects.toBeInstanceOf(VectorStoreError);
    try {
      await createVectorStore({ mode: 'pgvector', dimensions: DIM });
    } catch (error) {
      expect(error).toBeInstanceOf(VectorStoreError);
      expect((error as VectorStoreError).status).toBe(501);
      expect((error as VectorStoreError).message).toMatch(/Postgres/i);
    }
  });

  test('non-postgres URL rejected', async () => {
    await expect(
      createVectorStore({
        mode: 'pgvector',
        databaseUrl: 'sqlite://./x.db',
        dimensions: DIM,
      }),
    ).rejects.toMatchObject({
      status: 501,
      message: expect.stringMatching(/postgres/i),
    });
  });
});
