import { describe, expect, test } from 'bun:test';

import { CACHE_KEY_PREFIX } from '@agentos/core/builtins/cache-store/api/lib/create-redis-cache';
import type { RedisCacheClient } from '@agentos/core/builtins/cache-store/api/lib/create-redis-cache';
import { createCacheStore } from '@agentos/core/builtins/cache-store/api/lib/create-store';
import { handleCacheStoreRequest } from '@agentos/core/builtins/cache-store/api/lib/handle-request';

/** In-memory stand-in for Bun RedisClient — no live Redis required. */
function createMockRedisClient(): RedisCacheClient & {
  store: Map<string, { value: string; expiresAt: number | null }>;
} {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function live(
    key: string,
  ): { value: string; expiresAt: number | null } | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    store,
    async get(key: string): Promise<string | null> {
      return live(key)?.value ?? null;
    },
    async set(
      key: string,
      value: string,
      ex?: 'EX',
      seconds?: number,
    ): Promise<'OK'> {
      let expiresAt: number | null = null;
      if (ex === 'EX' && typeof seconds === 'number') {
        expiresAt = Date.now() + Math.floor(seconds) * 1000;
      }
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(...keys: string[]): Promise<number> {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted += 1;
      }
      return deleted;
    },
    async ttl(key: string): Promise<number> {
      const entry = live(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    },
  };
}

describe('builtin cache-store Redis backend', () => {
  test('createCacheStore picks redis when client injected', () => {
    const cache = createCacheStore({ redisClient: createMockRedisClient() });
    expect(cache.backend).toBe('redis');
  });

  test('createCacheStore defaults to memory without URL', () => {
    const cache = createCacheStore({});
    expect(cache.backend).toBe('memory');
  });

  test('health reports backend redis', async () => {
    const cache = createCacheStore({ redisClient: createMockRedisClient() });
    const health = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/health'),
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, backend: 'redis' });
  });

  test('set → get → ttl → del with namespaced keys', async () => {
    const mock = createMockRedisClient();
    const cache = createCacheStore({ redisClient: mock });

    const set = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'greeting', value: { hello: 'world' } }),
      }),
    );
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ ok: true });

    expect(mock.store.has(`${CACHE_KEY_PREFIX}greeting`)).toBe(true);
    expect(mock.store.get(`${CACHE_KEY_PREFIX}greeting`)?.value).toBe(
      JSON.stringify({ hello: 'world' }),
    );

    const get = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/get', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'greeting' }),
      }),
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      key: 'greeting',
      value: { hello: 'world' },
    });

    const ttl = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/ttl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'greeting' }),
      }),
    );
    expect(await ttl.json()).toEqual({ key: 'greeting', ttl: null });

    const del = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/del', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'greeting' }),
      }),
    );
    expect(await del.json()).toEqual({ deleted: 1 });

    const missing = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/get', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'greeting' }),
      }),
    );
    expect(missing.status).toBe(404);
  });

  test('set with ttl expires', async () => {
    const cache = createCacheStore({ redisClient: createMockRedisClient() });

    const set = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'ephemeral', value: 1, ttl: 1 }),
      }),
    );
    expect(set.status).toBe(200);

    const ttl = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/ttl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'ephemeral' }),
      }),
    );
    const ttlBody = (await ttl.json()) as { ttl: number | null };
    expect(ttlBody.ttl).toBeGreaterThanOrEqual(0);
    expect(ttlBody.ttl).toBeLessThanOrEqual(1);

    await Bun.sleep(1100);

    const get = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/get', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'ephemeral' }),
      }),
    );
    expect(get.status).toBe(404);
  });

  test('del multiple keys; bad ttl → 400', async () => {
    const cache = createCacheStore({ redisClient: createMockRedisClient() });

    await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'a', value: 1 }),
      }),
    );
    await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'b', value: 2 }),
      }),
    );

    const del = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/del', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: ['a', 'b', 'c'] }),
      }),
    );
    expect(await del.json()).toEqual({ deleted: 2 });

    const badTtl = await handleCacheStoreRequest(
      cache,
      new Request('http://127.0.0.1:6112/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'x', value: 1, ttl: -1 }),
      }),
    );
    expect(badTtl.status).toBe(400);
  });
});
