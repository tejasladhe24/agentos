import { RedisClient } from 'bun';

import {
  assertPositiveTtl,
  type CacheBackend,
  CacheError,
} from './create-cache';

/** Default prefix so shared Redis DBs do not collide with other apps. */
export const CACHE_KEY_PREFIX = 'agentos:cache:';

/**
 * Minimal Redis surface used by cache-store (Bun RedisClient-compatible).
 * Injected in tests; production uses `new RedisClient(url)`.
 */
export type RedisCacheClient = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ex?: 'EX',
    seconds?: number,
  ): Promise<'OK' | null | string>;
  del(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
  close?(): void;
};

export type RedisCache = CacheBackend & {
  backend: 'redis';
  close(): void;
};

export type CreateRedisCacheOptions = {
  /** `redis://…` / `rediss://…` URL (required unless `client` is injected). */
  url?: string;
  /** Test double or pre-built client. */
  client?: RedisCacheClient;
  keyPrefix?: string;
};

function encodeValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    throw new CacheError('value is not JSON-serializable', 400);
  }
}

function decodeValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Non-JSON legacy / foreign keys — return raw string.
    return raw;
  }
}

/**
 * Redis-backed cache with the same get/set/del/ttl semantics as memory.
 */
export function createRedisCache(
  options: CreateRedisCacheOptions = {},
): RedisCache {
  const prefix = options.keyPrefix ?? CACHE_KEY_PREFIX;
  const url = options.url?.trim();

  let client: RedisCacheClient;
  if (options.client) {
    client = options.client;
  } else if (url) {
    client = new RedisClient(url);
  } else {
    throw new CacheError(
      'Redis URL required (set AGENT_OS_EXT_CACHE_STORE_REDIS_URL)',
      500,
    );
  }

  function namespaced(key: string): string {
    return `${prefix}${key}`;
  }

  return {
    backend: 'redis',

    async get(key: string): Promise<unknown | undefined> {
      const raw = await client.get(namespaced(key));
      if (raw === null) return undefined;
      return decodeValue(raw);
    },

    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      assertPositiveTtl(ttlSeconds);
      const encoded = encodeValue(value);
      const redisKey = namespaced(key);
      if (ttlSeconds !== undefined) {
        await client.set(redisKey, encoded, 'EX', Math.floor(ttlSeconds));
      } else {
        await client.set(redisKey, encoded);
      }
    },

    async del(keys: string[]): Promise<number> {
      if (keys.length === 0) return 0;
      return client.del(...keys.map(namespaced));
    },

    async ttl(key: string): Promise<number | null> {
      const seconds = await client.ttl(namespaced(key));
      // Redis: -2 missing, -1 no expiry, >= 0 remaining seconds
      if (seconds < 0) return null;
      return seconds;
    },

    close(): void {
      client.close?.();
    },
  };
}
