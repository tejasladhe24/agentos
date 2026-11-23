export type OutboxStatus = 'pending' | 'leased' | 'acked' | 'dead';

export type OutboxRecord = {
  id: string;
  topic: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  availableAt: string;
  createdAt: string;
  leaseOwner?: string;
  leaseUntil?: string;
  lastError?: string;
  ackedAt?: string;
};

export type JobKind = 'at' | 'cron';
export type JobAction = 'publish' | 'http';

export type JobRecord = {
  id: string;
  kind: JobKind;
  action: JobAction;
  enabled: boolean;
  nextRunAt: string;
  createdAt: string;
  /** ISO run-at for `kind: 'at'`. */
  runAt?: string;
  /** Cron expr (`@every 30s` or 5-field) for `kind: 'cron'`. */
  cron?: string;
  topic?: string;
  payload?: unknown;
  url?: string;
  body?: unknown;
  lastRunAt?: string;
  lastError?: string;
};

export type DbStoreClient = {
  insertOutbox: (record: OutboxRecord) => Promise<OutboxRecord>;
  updateOutbox: (record: OutboxRecord) => Promise<OutboxRecord>;
  listOutbox: (status?: OutboxStatus) => Promise<OutboxRecord[]>;
  getOutbox: (id: string) => Promise<OutboxRecord | undefined>;
  insertJob: (record: JobRecord) => Promise<JobRecord>;
  updateJob: (record: JobRecord) => Promise<JobRecord>;
  listJobs: () => Promise<JobRecord[]>;
  getJob: (id: string) => Promise<JobRecord | undefined>;
  deleteJob: (id: string) => Promise<boolean>;
};

function parseOutbox(
  id: string,
  data: Record<string, unknown>,
): OutboxRecord | null {
  const topic = typeof data.topic === 'string' ? data.topic : '';
  const status = data.status;
  if (
    !topic ||
    (status !== 'pending' &&
      status !== 'leased' &&
      status !== 'acked' &&
      status !== 'dead')
  ) {
    return null;
  }
  const record: OutboxRecord = {
    id: typeof data.id === 'string' ? data.id : id,
    topic,
    payload: data.payload ?? null,
    status,
    attempts: typeof data.attempts === 'number' ? data.attempts : 0,
    availableAt:
      typeof data.availableAt === 'string'
        ? data.availableAt
        : new Date(0).toISOString(),
    createdAt:
      typeof data.createdAt === 'string'
        ? data.createdAt
        : new Date(0).toISOString(),
  };
  if (typeof data.leaseOwner === 'string') record.leaseOwner = data.leaseOwner;
  if (typeof data.leaseUntil === 'string') record.leaseUntil = data.leaseUntil;
  if (typeof data.lastError === 'string') record.lastError = data.lastError;
  if (typeof data.ackedAt === 'string') record.ackedAt = data.ackedAt;
  return record;
}

function parseJob(id: string, data: Record<string, unknown>): JobRecord | null {
  const kind = data.kind;
  const action = data.action;
  if (
    (kind !== 'at' && kind !== 'cron') ||
    (action !== 'publish' && action !== 'http')
  ) {
    return null;
  }
  const record: JobRecord = {
    id: typeof data.id === 'string' ? data.id : id,
    kind,
    action,
    enabled: data.enabled !== false,
    nextRunAt:
      typeof data.nextRunAt === 'string'
        ? data.nextRunAt
        : new Date(0).toISOString(),
    createdAt:
      typeof data.createdAt === 'string'
        ? data.createdAt
        : new Date(0).toISOString(),
  };
  if (typeof data.runAt === 'string') record.runAt = data.runAt;
  if (typeof data.cron === 'string') record.cron = data.cron;
  if (typeof data.topic === 'string') record.topic = data.topic;
  if ('payload' in data) record.payload = data.payload;
  if (typeof data.url === 'string') record.url = data.url;
  if ('body' in data) record.body = data.body;
  if (typeof data.lastRunAt === 'string') record.lastRunAt = data.lastRunAt;
  if (typeof data.lastError === 'string') record.lastError = data.lastError;
  return record;
}

type DocPayload = {
  items?: Array<{ id: string; data: Record<string, unknown> }>;
  documents?: Array<{ id: string; data: Record<string, unknown> }>;
};

async function queryDocs(
  root: string,
  collection: string,
  body: Record<string, unknown>,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const res = await fetch(
    `${root}/collections/${encodeURIComponent(collection)}/query`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `db-store query failed (${res.status}): ${detail || res.statusText}`,
    );
  }
  const payload = (await res.json()) as DocPayload;
  return payload.items ?? payload.documents ?? [];
}

/**
 * HTTP client for events outbox + jobs collections via builtin db-store.
 */
export function createDbStoreClient(
  baseUrl: string,
  outboxCollection: string,
  jobsCollection: string,
): DbStoreClient {
  const root = baseUrl.replace(/\/+$/, '');

  return {
    async insertOutbox(record) {
      const res = await fetch(
        `${root}/collections/${encodeURIComponent(outboxCollection)}/insert`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: record.id, data: record }),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return record;
    },

    async updateOutbox(record) {
      const res = await fetch(
        `${root}/collections/${encodeURIComponent(outboxCollection)}/update`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: record.id, data: record }),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store update failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return record;
    },

    async listOutbox(status) {
      const body: { where?: { status: OutboxStatus }; limit?: number } = {
        limit: 1000,
      };
      if (status) body.where = { status };
      const docs = await queryDocs(root, outboxCollection, body);
      return docs
        .map((doc) => parseOutbox(doc.id, doc.data ?? {}))
        .filter((r): r is OutboxRecord => r !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getOutbox(id) {
      const docs = await queryDocs(root, outboxCollection, {
        where: { id },
        limit: 1,
      });
      const doc = docs[0];
      if (!doc) return undefined;
      return parseOutbox(doc.id, doc.data ?? {}) ?? undefined;
    },

    async insertJob(record) {
      const res = await fetch(
        `${root}/collections/${encodeURIComponent(jobsCollection)}/insert`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: record.id, data: record }),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return record;
    },

    async updateJob(record) {
      const res = await fetch(
        `${root}/collections/${encodeURIComponent(jobsCollection)}/update`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: record.id, data: record }),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store update failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return record;
    },

    async listJobs() {
      const docs = await queryDocs(root, jobsCollection, { limit: 500 });
      return docs
        .map((doc) => parseJob(doc.id, doc.data ?? {}))
        .filter((r): r is JobRecord => r !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getJob(id) {
      const docs = await queryDocs(root, jobsCollection, {
        where: { id },
        limit: 1,
      });
      const doc = docs[0];
      if (!doc) return undefined;
      return parseJob(doc.id, doc.data ?? {}) ?? undefined;
    },

    async deleteJob(id) {
      const res = await fetch(
        `${root}/collections/${encodeURIComponent(jobsCollection)}/delete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store delete failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const payload = (await res.json()) as { deleted?: number };
      return (payload.deleted ?? 0) > 0;
    },
  };
}
