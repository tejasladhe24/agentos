/**
 * @agentos/core/api/store — db + cache HTTP clients for FDE routes (ticket 22).
 * Talks only to builtins via `/api/ext/db-store` and `/api/ext/cache-store`.
 * No Drizzle, Redis, or DATABASE_URL in this kit (ADR 004).
 */

const DEFAULT_GATEWAY = 'http://127.0.0.1:5173';

export type DocumentRow = {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type QueryInput = {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
};

export type InsertInput = {
  id?: string;
  data: Record<string, unknown>;
};

export type UpdateInput = {
  id: string;
  data: Record<string, unknown>;
  merge?: boolean;
};

export type DeleteInput = {
  id?: string;
  ids?: string[];
};

export type QueryResult = {
  items: DocumentRow[];
};

export type DeleteResult = {
  deleted: number;
};

export type CacheDelResult = {
  deleted: number;
};

/** Resolve builtin db-store API base (`…/api/ext/db-store` or test override). */
export function resolveDbStoreApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  if (env.AGENT_OS_DB_STORE_API_BASE) {
    return env.AGENT_OS_DB_STORE_API_BASE.replace(/\/$/, '');
  }
  const gateway = (env.AGENT_OS_GLOBAL_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(
    /\/$/,
    '',
  );
  return `${gateway}/api/ext/db-store`;
}

/** Resolve builtin cache-store API base (`…/api/ext/cache-store` or test override). */
export function resolveCacheStoreApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  if (env.AGENT_OS_CACHE_STORE_API_BASE) {
    return env.AGENT_OS_CACHE_STORE_API_BASE.replace(/\/$/, '');
  }
  const gateway = (env.AGENT_OS_GLOBAL_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(
    /\/$/,
    '',
  );
  return `${gateway}/api/ext/cache-store`;
}

async function postJson<T>(
  url: string,
  body: unknown,
  label: string,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `${label} failed (${res.status}): ${detail || res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

export type CollectionOptions = {
  /** Override API base (peer URL or gateway `/api/ext/db-store`). */
  apiBase?: string;
};

function createCollection(name: string, options: CollectionOptions = {}) {
  const encoded = encodeURIComponent(name);
  const resolveBase = (): string => {
    if (options.apiBase) {
      return options.apiBase.replace(/\/$/, '');
    }
    return resolveDbStoreApiBase();
  };

  return {
    async query(input: QueryInput = {}): Promise<QueryResult> {
      const base = resolveBase();
      return postJson<QueryResult>(
        `${base}/collections/${encoded}/query`,
        input,
        'db-store query',
      );
    },

    async insert(input: InsertInput): Promise<DocumentRow> {
      const base = resolveBase();
      return postJson<DocumentRow>(
        `${base}/collections/${encoded}/insert`,
        input,
        'db-store insert',
      );
    },

    async update(input: UpdateInput): Promise<DocumentRow> {
      const base = resolveBase();
      return postJson<DocumentRow>(
        `${base}/collections/${encoded}/update`,
        input,
        'db-store update',
      );
    },

    async delete(input: DeleteInput = {}): Promise<DeleteResult> {
      const base = resolveBase();
      return postJson<DeleteResult>(
        `${base}/collections/${encoded}/delete`,
        input,
        'db-store delete',
      );
    },
  };
}

export type CollectionClient = ReturnType<typeof createCollection>;

/** Document store client → builtin db-store. */
export const dbStore = {
  collection(name: string, options?: CollectionOptions): CollectionClient {
    return createCollection(name, options);
  },
};

/** Key/value cache client → builtin cache-store. */
export const cacheStore = {
  async get(key: string): Promise<unknown | null> {
    const base = resolveCacheStoreApiBase();
    const res = await fetch(`${base}/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(
        `cache-store get failed (${res.status}): ${detail || res.statusText}`,
      );
    }
    const body = (await res.json()) as { value?: unknown };
    return body.value;
  },

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const base = resolveCacheStoreApiBase();
    const body: { key: string; value: unknown; ttl?: number } = { key, value };
    if (ttl !== undefined) {
      body.ttl = ttl;
    }
    await postJson<{ ok: true }>(`${base}/set`, body, 'cache-store set');
  },

  async del(key: string | string[]): Promise<CacheDelResult> {
    const base = resolveCacheStoreApiBase();
    const body = Array.isArray(key) ? { keys: key } : { key };
    return postJson<CacheDelResult>(`${base}/del`, body, 'cache-store del');
  },
};
