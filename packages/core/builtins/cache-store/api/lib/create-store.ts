import {
  createMemoryCache,
  type CacheBackend,
} from './create-cache';
import {
  createRedisCache,
  type RedisCacheClient,
} from './create-redis-cache';

export type CreateCacheStoreOptions = {
  /** When set, use Redis; otherwise in-memory. */
  redisUrl?: string;
  /** Injected Redis client (tests); implies Redis backend even without URL. */
  redisClient?: RedisCacheClient;
};

/**
 * Build the cache backend.
 * - memory — default (no Redis URL)
 * - redis — when `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` (or `redisClient`) is set
 */
export function createCacheStore(
  options: CreateCacheStoreOptions = {},
): CacheBackend {
  const url = options.redisUrl?.trim();
  if (options.redisClient || url) {
    return createRedisCache({
      url,
      client: options.redisClient,
    });
  }
  return createMemoryCache();
}
