import { HITL_COLLECTION } from './constants';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type Approval = {
  id: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
};

export type DbStoreClient = {
  insert: (approval: Approval) => Promise<Approval>;
  query: (status?: ApprovalStatus) => Promise<Approval[]>;
  get: (id: string) => Promise<Approval | undefined>;
  update: (approval: Approval) => Promise<Approval>;
};

function parseApproval(
  id: string,
  data: Record<string, unknown>,
): Approval | null {
  const title = typeof data.title === 'string' ? data.title : '';
  const status = data.status;
  if (
    !title ||
    (status !== 'pending' && status !== 'approved' && status !== 'rejected')
  ) {
    return null;
  }
  const approval: Approval = {
    id: typeof data.id === 'string' ? data.id : id,
    title,
    status,
    createdAt:
      typeof data.createdAt === 'string'
        ? data.createdAt
        : new Date(0).toISOString(),
  };
  if (typeof data.body === 'string') approval.body = data.body;
  if (
    data.metadata &&
    typeof data.metadata === 'object' &&
    !Array.isArray(data.metadata)
  ) {
    approval.metadata = data.metadata as Record<string, unknown>;
  }
  if (typeof data.resolvedAt === 'string') {
    approval.resolvedAt = data.resolvedAt;
  }
  return approval;
}

export function createDbStoreClient(baseUrl: string): DbStoreClient {
  const root = baseUrl.replace(/\/+$/, '');
  const collection = encodeURIComponent(HITL_COLLECTION);

  return {
    async insert(approval) {
      const res = await fetch(`${root}/collections/${collection}/insert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: approval.id, data: approval }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return approval;
    },

    async query(status) {
      const body: { where?: { status: ApprovalStatus }; limit?: number } = {
        limit: 500,
      };
      if (status) body.where = { status };
      const res = await fetch(`${root}/collections/${collection}/query`, {
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
      return docs
        .map((doc) => parseApproval(doc.id, doc.data ?? {}))
        .filter((a): a is Approval => a !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async get(id) {
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ where: { id }, limit: 1 }),
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
      const doc = docs[0];
      if (!doc) return undefined;
      return parseApproval(doc.id, doc.data ?? {}) ?? undefined;
    },

    async update(approval) {
      const res = await fetch(`${root}/collections/${collection}/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: approval.id, data: approval }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store update failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return approval;
    },
  };
}
