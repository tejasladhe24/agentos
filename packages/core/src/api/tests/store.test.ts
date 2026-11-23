import { afterEach, describe, expect, test } from 'bun:test';

import * as storeKit from '@agentos/core/api/store';
import {
  cacheStore,
  dbStore,
  resolveCacheStoreApiBase,
  resolveDbStoreApiBase,
  type DocumentRow,
} from '@agentos/core/api/store';

const originalFetch = globalThis.fetch;
const originalDbBase = Bun.env.AGENT_OS_DB_STORE_API_BASE;
const originalCacheBase = Bun.env.AGENT_OS_CACHE_STORE_API_BASE;
const originalGateway = Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDbBase === undefined) {
    delete Bun.env.AGENT_OS_DB_STORE_API_BASE;
  } else {
    Bun.env.AGENT_OS_DB_STORE_API_BASE = originalDbBase;
  }
  if (originalCacheBase === undefined) {
    delete Bun.env.AGENT_OS_CACHE_STORE_API_BASE;
  } else {
    Bun.env.AGENT_OS_CACHE_STORE_API_BASE = originalCacheBase;
  }
  if (originalGateway === undefined) {
    delete Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL;
  } else {
    Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL = originalGateway;
  }
});

type Captured = {
  url: string;
  method: string;
  body: unknown;
};

function mockStoreFetch(handler: (req: Captured) => Response): void {
  Bun.env.AGENT_OS_DB_STORE_API_BASE = 'http://db.test';
  Bun.env.AGENT_OS_CACHE_STORE_API_BASE = 'http://cache.test';

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }
    return handler({ url, method, body });
  }) as typeof fetch;
}

const SAMPLE_DOC: DocumentRow = {
  id: 'doc-1',
  data: { name: 'Ada' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('resolveDbStoreApiBase / resolveCacheStoreApiBase', () => {
  test('defaults to gateway /api/ext/{db-store|cache-store}', () => {
    delete Bun.env.AGENT_OS_DB_STORE_API_BASE;
    delete Bun.env.AGENT_OS_CACHE_STORE_API_BASE;
    delete Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL;
    expect(resolveDbStoreApiBase({})).toBe(
      'http://127.0.0.1:5173/api/ext/db-store',
    );
    expect(resolveCacheStoreApiBase({})).toBe(
      'http://127.0.0.1:5173/api/ext/cache-store',
    );
  });

  test('explicit API_BASE overrides win', () => {
    expect(
      resolveDbStoreApiBase({
        AGENT_OS_DB_STORE_API_BASE: 'http://127.0.0.1:6111/',
      }),
    ).toBe('http://127.0.0.1:6111');
    expect(
      resolveCacheStoreApiBase({
        AGENT_OS_CACHE_STORE_API_BASE: 'http://127.0.0.1:6112/',
      }),
    ).toBe('http://127.0.0.1:6112');
  });

  test('AGENT_OS_GLOBAL_GATEWAY_URL used when no override', () => {
    expect(
      resolveDbStoreApiBase({
        AGENT_OS_GLOBAL_GATEWAY_URL: 'http://gw.example/',
      }),
    ).toBe('http://gw.example/api/ext/db-store');
  });
});

describe('dbStore', () => {
  test('collection.query posts body and returns items', async () => {
    mockStoreFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://db.test/collections/contacts/query');
      expect(body).toEqual({ where: { name: 'Ada' }, limit: 10 });
      return Response.json({ items: [SAMPLE_DOC] });
    });

    const result = await dbStore.collection('contacts').query({
      where: { name: 'Ada' },
      limit: 10,
    });
    expect(result.items).toEqual([SAMPLE_DOC]);
  });

  test('collection.orgId sends X-AgentOS-Org-Id', async () => {
    const seen: { org: string | null } = { org: null };
    Bun.env.AGENT_OS_DB_STORE_API_BASE = 'http://db.test';
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const headers = new Headers(init?.headers);
      seen.org = headers.get('x-agentos-org-id');
      return Response.json({ items: [] });
    }) as typeof fetch;

    await dbStore.collection('contacts', { orgId: 'org-99' }).query({});
    expect(seen.org).toBe('org-99');
  });

  test('collection.insert / update / delete', async () => {
    const calls: Captured[] = [];
    mockStoreFetch((req) => {
      calls.push(req);
      if (req.url.endsWith('/insert')) {
        return Response.json(SAMPLE_DOC, { status: 201 });
      }
      if (req.url.endsWith('/update')) {
        return Response.json({
          ...SAMPLE_DOC,
          data: { name: 'Ada Lovelace' },
        });
      }
      if (req.url.endsWith('/delete')) {
        return Response.json({ deleted: 1 });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    });

    const col = dbStore.collection('contacts');
    expect(await col.insert({ id: 'doc-1', data: { name: 'Ada' } })).toEqual(
      SAMPLE_DOC,
    );
    expect(
      await col.update({
        id: 'doc-1',
        data: { name: 'Ada Lovelace' },
        merge: true,
      }),
    ).toMatchObject({ id: 'doc-1', data: { name: 'Ada Lovelace' } });
    expect(await col.delete({ id: 'doc-1' })).toEqual({ deleted: 1 });

    expect(calls.map((c) => c.url)).toEqual([
      'http://db.test/collections/contacts/insert',
      'http://db.test/collections/contacts/update',
      'http://db.test/collections/contacts/delete',
    ]);
    expect(calls[1]?.body).toEqual({
      id: 'doc-1',
      data: { name: 'Ada Lovelace' },
      merge: true,
    });
  });

  test('collection.insertBulk / retention / prune', async () => {
    const calls: Captured[] = [];
    mockStoreFetch((req) => {
      calls.push(req);
      if (req.url.endsWith('/insert-bulk')) {
        return Response.json({ items: [SAMPLE_DOC] }, { status: 201 });
      }
      if (req.url.endsWith('/retention')) {
        return Response.json(
          {
            policy: {
              orgId: 'org-1',
              collection: 'contacts',
              maxCount: 10,
            },
          },
          { status: 201 },
        );
      }
      if (req.url.endsWith('/prune')) {
        return Response.json({ deleted: 2 });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    });

    const col = dbStore.collection('contacts', { orgId: 'org-1' });
    expect(await col.insertBulk({ docs: [{ data: { name: 'Ada' } }] })).toEqual(
      { items: [SAMPLE_DOC] },
    );
    await col.setRetention({ maxCount: 10 });
    expect(await col.prune()).toEqual({ deleted: 2 });
    expect(calls.map((c) => c.url)).toEqual([
      'http://db.test/collections/contacts/insert-bulk',
      'http://db.test/collections/contacts/retention',
      'http://db.test/collections/contacts/prune',
    ]);
  });

  test('org retention + deleteSubject', async () => {
    const calls: Captured[] = [];
    mockStoreFetch((req) => {
      calls.push(req);
      if (
        req.url.endsWith('/org-retention') &&
        req.body &&
        typeof req.body === 'object' &&
        'legalHold' in (req.body as object)
      ) {
        return Response.json(
          {
            config: {
              orgId: 'org-1',
              legalHold: true,
              holdReason: 'litigation',
            },
          },
          { status: 201 },
        );
      }
      if (req.url.endsWith('/org-retention')) {
        return Response.json({
          config: { orgId: 'org-1', legalHold: true },
        });
      }
      if (req.url.endsWith('/subjects/delete')) {
        return Response.json({
          subjectId: 'ada@example.com',
          mode: 'delete',
          orgId: 'org-1',
          collections: [
            { name: 'candidates', matched: 1, deleted: 1, anonymized: 0 },
          ],
          files: [{ key: 'r.pdf', ok: true }],
          auditId: 'a1',
        });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    });

    expect(
      await dbStore.setOrgRetention(
        { legalHold: true, holdReason: 'litigation' },
        { orgId: 'org-1' },
      ),
    ).toMatchObject({ config: { legalHold: true } });
    expect(await dbStore.getOrgRetention({ orgId: 'org-1' })).toMatchObject({
      config: { orgId: 'org-1', legalHold: true },
    });
    expect(
      await dbStore.deleteSubject(
        {
          subjectId: 'ada@example.com',
          collections: [
            { name: 'candidates', where: { email: 'ada@example.com' } },
          ],
          fileKeys: ['r.pdf'],
        },
        { orgId: 'org-1' },
      ),
    ).toMatchObject({ auditId: 'a1' });
    expect(calls.map((c) => c.url)).toEqual([
      'http://db.test/org-retention',
      'http://db.test/org-retention',
      'http://db.test/subjects/delete',
    ]);
  });

  test('encodes collection name in URL', async () => {
    mockStoreFetch(({ url }) => {
      expect(url).toBe('http://db.test/collections/a%2Fb/query');
      return Response.json({ items: [] });
    });
    await dbStore.collection('a/b').query();
  });

  test('non-2xx throws', async () => {
    mockStoreFetch(() => Response.json({ error: 'boom' }, { status: 500 }));
    await expect(dbStore.collection('contacts').query()).rejects.toThrow(
      /db-store query failed \(500\)/,
    );
  });
});

describe('cacheStore', () => {
  test('get returns value on hit', async () => {
    mockStoreFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://cache.test/get');
      expect(body).toEqual({ key: 'k1' });
      return Response.json({ key: 'k1', value: { n: 1 } });
    });
    expect(await cacheStore.get('k1')).toEqual({ n: 1 });
  });

  test('get returns null on 404', async () => {
    mockStoreFetch(() =>
      Response.json({ error: 'not found' }, { status: 404 }),
    );
    expect(await cacheStore.get('missing')).toBeNull();
  });

  test('set posts key/value/ttl', async () => {
    mockStoreFetch(({ url, body }) => {
      expect(url).toBe('http://cache.test/set');
      expect(body).toEqual({ key: 'k1', value: 'v', ttl: 60 });
      return Response.json({ ok: true });
    });
    await cacheStore.set('k1', 'v', 60);
  });

  test('del accepts string or string[]', async () => {
    const bodies: unknown[] = [];
    mockStoreFetch(({ url, body }) => {
      expect(url).toBe('http://cache.test/del');
      bodies.push(body);
      return Response.json({
        deleted: Array.isArray((body as { keys?: string[] }).keys) ? 2 : 1,
      });
    });
    expect(await cacheStore.del('a')).toEqual({ deleted: 1 });
    expect(await cacheStore.del(['a', 'b'])).toEqual({ deleted: 2 });
    expect(bodies).toEqual([{ key: 'a' }, { keys: ['a', 'b'] }]);
  });

  test('non-2xx get throws (not 404)', async () => {
    mockStoreFetch(() => Response.json({ error: 'down' }, { status: 503 }));
    await expect(cacheStore.get('k1')).rejects.toThrow(
      /cache-store get failed \(503\)/,
    );
  });
});

describe('kit surface (no DATABASE_URL / drizzle)', () => {
  test('exports only HTTP client surface', () => {
    const keys = Object.keys(storeKit).sort();
    expect(keys).toEqual(
      [
        'cacheStore',
        'dbStore',
        'DB_STORE_ORG_ID_HEADER',
        'resolveCacheStoreApiBase',
        'resolveDbStoreApiBase',
      ].sort(),
    );
    expect(keys.some((k) => /database|drizzle|redis|sql/i.test(k))).toBe(false);
    expect('DATABASE_URL' in storeKit).toBe(false);
  });
});
