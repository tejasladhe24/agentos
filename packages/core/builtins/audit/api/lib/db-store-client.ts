import { AUDIT_COLLECTION } from './constants';

export type AuditEntryInput = {
  action: string;
  actor?: string;
  resource?: string;
  meta?: Record<string, unknown>;
  /** Tenant stamp for Activity list filtering (platform collection soft-tenancy). */
  orgId?: string;
};

export type AuditEntry = AuditEntryInput & {
  id: string;
  at: string;
};

export type QueryInput = {
  where?: Record<string, unknown>;
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
};

export type DbStoreClient = {
  insert: (entry: AuditEntry) => Promise<AuditEntry>;
  query: (input?: QueryInput) => Promise<AuditEntry[]>;
};

function mapDoc(doc: {
  id: string;
  data: Record<string, unknown>;
}): AuditEntry {
  const data = doc.data ?? {};
  return {
    id: doc.id,
    action: typeof data.action === 'string' ? data.action : '',
    actor: typeof data.actor === 'string' ? data.actor : undefined,
    resource: typeof data.resource === 'string' ? data.resource : undefined,
    meta:
      data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)
        ? (data.meta as Record<string, unknown>)
        : undefined,
    orgId: typeof data.orgId === 'string' ? data.orgId : undefined,
    at: typeof data.at === 'string' ? data.at : '',
  };
}

export function createDbStoreClient(baseUrl: string): DbStoreClient {
  const root = baseUrl.replace(/\/+$/, '');

  return {
    async insert(entry) {
      const res = await fetch(
        `${root}/collections/${AUDIT_COLLECTION}/insert`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: entry.id, data: entry }),
        },
      );
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return entry;
    },

    async query(input: QueryInput = {}) {
      const limit = input.limit ?? 50;
      const body: QueryInput = {
        limit,
        sort: input.sort ?? { at: 'desc' },
      };
      if (input.where) body.where = input.where;
      if (input.offset !== undefined) body.offset = input.offset;

      const res = await fetch(`${root}/collections/${AUDIT_COLLECTION}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store query failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const payload = (await res.json()) as {
        items?: Array<{ id: string; data: Record<string, unknown> }>;
        documents?: Array<{ id: string; data: Record<string, unknown> }>;
      };
      const docs = payload.items ?? payload.documents ?? [];
      return docs.map(mapDoc);
    },
  };
}
