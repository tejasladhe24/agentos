/**
 * Cache backend surface — in-memory default; Redis when URL is set.
 * Methods are async so Redis and memory share one handler path.
 */
export type CacheBackend = {
  backend: 'memory' | 'redis';
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(keys: string[]): Promise<number>;
  /** Remaining TTL in seconds, or `null` if missing / no expiry. */
  ttl(key: string): Promise<number | null>;
};

type Entry = {
  value: unknown;
  /** Unix ms expiry; `null` = no expiry. */
  expiresAt: number | null;
};

export type MemoryCache = CacheBackend & {
  backend: 'memory';
  size(): number;
};

/** Shared TTL validation for memory + Redis backends. */
export function assertPositiveTtl(ttlSeconds: number | undefined): void {
  if (ttlSeconds === undefined) return;
  if (
    typeof ttlSeconds !== 'number' ||
    !Number.isFinite(ttlSeconds) ||
    ttlSeconds <= 0
  ) {
    throw new CacheError('ttl must be a positive number of seconds', 400);
  }
}

/**
 * In-memory Map cache with lazy expiry on read.
 */
export function createMemoryCache(): MemoryCache {
  const store = new Map<string, Entry>();

  function isExpired(entry: Entry, now = Date.now()): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= now;
  }

  function getLive(key: string): Entry | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (isExpired(entry)) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    backend: 'memory',

    async get(key: string): Promise<unknown | undefined> {
      const entry = getLive(key);
      return entry?.value;
    },

    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      assertPositiveTtl(ttlSeconds);
      let expiresAt: number | null = null;
      if (ttlSeconds !== undefined) {
        expiresAt = Date.now() + Math.floor(ttlSeconds) * 1000;
      }
      store.set(key, { value, expiresAt });
    },

    async del(keys: string[]): Promise<number> {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted += 1;
      }
      return deleted;
    },

    async ttl(key: string): Promise<number | null> {
      const entry = getLive(key);
      if (!entry) return null;
      if (entry.expiresAt === null) return null;
      const remainingMs = entry.expiresAt - Date.now();
      return Math.max(0, Math.ceil(remainingMs / 1000));
    },

    size(): number {
      // Opportunistic sweep so size reflects live keys.
      for (const [key, entry] of store) {
        if (isExpired(entry)) store.delete(key);
      }
      return store.size;
    },
  };
}

export class CacheError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CacheError';
    this.status = status;
  }
}
