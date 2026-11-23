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
  /** `{ field: 'asc' | 'desc' }` — key order is sort priority. */
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
};

export type InsertInput = {
  id?: string;
  data: Record<string, unknown>;
};

export type BulkInsertInput = {
  docs: InsertInput[];
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

export type RetentionPolicy = {
  ttlSeconds?: number;
  maxCount?: number;
  maxCountGroupBy?: string;
};

export type RetentionPolicyRecord = RetentionPolicy & {
  orgId: string;
  collection: string;
};

export type OrgRetentionConfig = {
  defaultTtlSeconds?: number;
  legalHold: boolean;
  holdReason?: string;
  optedInCollections?: string[];
};

export type OrgRetentionRecord = OrgRetentionConfig & {
  orgId: string;
};

export type SubjectCollectionTarget = {
  name: string;
  where: Record<string, unknown>;
  anonymizeFields?: string[];
};

export type SubjectDeleteInput = {
  subjectId: string;
  mode?: 'delete' | 'anonymize';
  collections?: SubjectCollectionTarget[];
  fileKeys?: string[];
  actor?: string;
};

export type SubjectDeleteResult = {
  subjectId: string;
  mode: 'delete' | 'anonymize';
  orgId: string;
  collections: Array<{
    name: string;
    matched: number;
    deleted: number;
    anonymized: number;
  }>;
  files: Array<{ key: string; ok: boolean; error?: string }>;
  auditId?: string;
};

export type QueryResult = {
  items: DocumentRow[];
};

export type BulkInsertResult = {
  items: DocumentRow[];
};

export type DeleteResult = {
  deleted: number;
};

export type PruneResult = {
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

/** Trusted peer / FDE header for active org (matches db-store builtin). */
export const DB_STORE_ORG_ID_HEADER = 'x-agentos-org-id';

async function postJson<T>(
  url: string,
  body: unknown,
  label: string,
  extraHeaders?: HeadersInit,
): Promise<T> {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json');
  const res = await fetch(url, {
    method: 'POST',
    headers,
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
  /**
   * Active org id sent as `X-AgentOS-Org-Id`.
   * Required for tenant collections when the request has no auth cookie.
   * Platform collections (`agentos_gateway`, hitl/audit/notifications) ignore this.
   */
  orgId?: string;
  /** Extra headers (e.g. forward `cookie` from the inbound FDE request). */
  headers?: HeadersInit;
};

function collectionRequestHeaders(options: CollectionOptions): Headers {
  const headers = new Headers(options.headers);
  if (options.orgId) {
    headers.set(DB_STORE_ORG_ID_HEADER, options.orgId);
  }
  return headers;
}

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
        collectionRequestHeaders(options),
      );
    },

    async insert(input: InsertInput): Promise<DocumentRow> {
      const base = resolveBase();
      return postJson<DocumentRow>(
        `${base}/collections/${encoded}/insert`,
        input,
        'db-store insert',
        collectionRequestHeaders(options),
      );
    },

    /** All-or-nothing batch insert (bounded server-side, default max 100). */
    async insertBulk(input: BulkInsertInput): Promise<BulkInsertResult> {
      const base = resolveBase();
      return postJson<BulkInsertResult>(
        `${base}/collections/${encoded}/insert-bulk`,
        input,
        'db-store insert-bulk',
        collectionRequestHeaders(options),
      );
    },

    async update(input: UpdateInput): Promise<DocumentRow> {
      const base = resolveBase();
      return postJson<DocumentRow>(
        `${base}/collections/${encoded}/update`,
        input,
        'db-store update',
        collectionRequestHeaders(options),
      );
    },

    async delete(input: DeleteInput = {}): Promise<DeleteResult> {
      const base = resolveBase();
      return postJson<DeleteResult>(
        `${base}/collections/${encoded}/delete`,
        input,
        'db-store delete',
        collectionRequestHeaders(options),
      );
    },

    /** Read retention policy for this collection + org (`{ get: true }`). */
    async getRetention(): Promise<{ policy: RetentionPolicyRecord | null }> {
      const base = resolveBase();
      return postJson<{ policy: RetentionPolicyRecord | null }>(
        `${base}/collections/${encoded}/retention`,
        { get: true },
        'db-store get retention',
        collectionRequestHeaders(options),
      );
    },

    /** Set per-collection retention (ttlSeconds and/or maxCount). */
    async setRetention(
      policy: RetentionPolicy,
    ): Promise<{ policy: RetentionPolicyRecord }> {
      const base = resolveBase();
      return postJson<{ policy: RetentionPolicyRecord }>(
        `${base}/collections/${encoded}/retention`,
        policy,
        'db-store set retention',
        collectionRequestHeaders(options),
      );
    },

    async clearRetention(): Promise<{ cleared: boolean }> {
      const base = resolveBase();
      return postJson<{ cleared: boolean }>(
        `${base}/collections/${encoded}/retention`,
        { clear: true },
        'db-store clear retention',
        collectionRequestHeaders(options),
      );
    },

    /** Run TTL / maxCount prune for this collection + org. */
    async prune(): Promise<PruneResult> {
      const base = resolveBase();
      return postJson<PruneResult>(
        `${base}/collections/${encoded}/prune`,
        {},
        'db-store prune',
        collectionRequestHeaders(options),
      );
    },
  };
}

export type CollectionClient = ReturnType<typeof createCollection>;

function dbStoreRequestHeaders(options: CollectionOptions = {}): Headers {
  return collectionRequestHeaders(options);
}

function resolveDbBase(options: CollectionOptions = {}): string {
  if (options.apiBase) return options.apiBase.replace(/\/$/, '');
  return resolveDbStoreApiBase();
}

/** Document store client → builtin db-store. */
export const dbStore = {
  collection(name: string, options?: CollectionOptions): CollectionClient {
    return createCollection(name, options);
  },

  /** Read org-level retention / legal hold (`POST /org-retention` with `{ get: true }`). */
  async getOrgRetention(
    options: CollectionOptions = {},
  ): Promise<{ config: OrgRetentionRecord | null }> {
    return postJson<{ config: OrgRetentionRecord | null }>(
      `${resolveDbBase(options)}/org-retention`,
      { get: true },
      'db-store get org retention',
      dbStoreRequestHeaders(options),
    );
  },

  /** Set org-level retention / legal hold. */
  async setOrgRetention(
    config: OrgRetentionConfig,
    options: CollectionOptions = {},
  ): Promise<{ config: OrgRetentionRecord }> {
    return postJson<{ config: OrgRetentionRecord }>(
      `${resolveDbBase(options)}/org-retention`,
      config,
      'db-store set org retention',
      dbStoreRequestHeaders(options),
    );
  },

  async clearOrgRetention(
    options: CollectionOptions = {},
  ): Promise<{ cleared: boolean }> {
    return postJson<{ cleared: boolean }>(
      `${resolveDbBase(options)}/org-retention`,
      { clear: true },
      'db-store clear org retention',
      dbStoreRequestHeaders(options),
    );
  },

  /**
   * Delete or anonymize docs matching caller-declared collection filters,
   * plus explicit file keys. Legal hold → error.
   */
  async deleteSubject(
    input: SubjectDeleteInput,
    options: CollectionOptions = {},
  ): Promise<SubjectDeleteResult> {
    return postJson<SubjectDeleteResult>(
      `${resolveDbBase(options)}/subjects/delete`,
      input,
      'db-store deleteSubject',
      dbStoreRequestHeaders(options),
    );
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
