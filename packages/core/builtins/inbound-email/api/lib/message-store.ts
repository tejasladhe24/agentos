import { MESSAGES_COLLECTION, MESSAGES_PAGE_MAX } from './constants';
import type {
  EmailAuthentication,
  InboundMessage,
  StoredAttachment,
} from './types';

export type ListMessagesQuery = {
  orgId: string;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  q?: string;
};

export type MessageDb = {
  insertMessage: (row: InboundMessage) => Promise<InboundMessage>;
  getByDeliveryId: (
    orgId: string,
    deliveryId: string,
  ) => Promise<InboundMessage | undefined>;
  getById: (orgId: string, id: string) => Promise<InboundMessage | undefined>;
  list: (query: ListMessagesQuery) => Promise<InboundMessage[]>;
  markRead: (orgId: string, id: string) => Promise<InboundMessage | undefined>;
};

function parseAttachments(raw: unknown): StoredAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const filename = typeof row.filename === 'string' ? row.filename : '';
    const contentType =
      typeof row.contentType === 'string'
        ? row.contentType
        : 'application/octet-stream';
    const key = typeof row.key === 'string' ? row.key : '';
    const bytes = typeof row.bytes === 'number' ? row.bytes : 0;
    if (!filename || !key) continue;
    out.push({ filename, contentType, key, bytes });
  }
  return out;
}

function parseRow(
  id: string,
  data: Record<string, unknown>,
): InboundMessage | null {
  const orgId = typeof data.orgId === 'string' ? data.orgId : '';
  const deliveryId = typeof data.deliveryId === 'string' ? data.deliveryId : '';
  if (!orgId || !deliveryId) return null;
  const toRaw = data.to;
  const to = Array.isArray(toRaw)
    ? toRaw.filter((v): v is string => typeof v === 'string')
    : [];
  const row: InboundMessage = {
    id: typeof data.id === 'string' ? data.id : id,
    orgId,
    deliveryId,
    provider: typeof data.provider === 'string' ? data.provider : 'unknown',
    from: typeof data.from === 'string' ? data.from : '',
    to,
    subject: typeof data.subject === 'string' ? data.subject : '',
    text: typeof data.text === 'string' ? data.text : undefined,
    html: typeof data.html === 'string' ? data.html : undefined,
    attachments: parseAttachments(data.attachments),
    receivedAt:
      typeof data.receivedAt === 'string'
        ? data.receivedAt
        : new Date(0).toISOString(),
  };
  if (typeof data.readAt === 'string' && data.readAt.length > 0) {
    row.readAt = data.readAt;
  }
  const auth = data.authentication;
  if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
    const verdicts: EmailAuthentication = {};
    for (const key of ['spf', 'dkim', 'dmarc'] as const) {
      const value = (auth as Record<string, unknown>)[key];
      if (typeof value === 'string') verdicts[key] = value;
    }
    row.authentication = verdicts;
  }
  return row;
}

function matchesFilters(
  row: InboundMessage,
  query: ListMessagesQuery,
): boolean {
  if (query.from) {
    const needle = query.from.trim().toLowerCase();
    if (!row.from.toLowerCase().includes(needle)) return false;
  }
  if (query.to) {
    const needle = query.to.trim().toLowerCase();
    if (!row.to.some((addr) => addr.toLowerCase().includes(needle))) {
      return false;
    }
  }
  if (query.q) {
    const needle = query.q.trim().toLowerCase();
    const hay =
      `${row.subject} ${row.from} ${row.to.join(' ')} ${row.text ?? ''}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function createMessageDb(baseUrl: string): MessageDb {
  const root = baseUrl.replace(/\/+$/, '');
  const collection = encodeURIComponent(MESSAGES_COLLECTION);

  return {
    async insertMessage(row) {
      const res = await fetch(`${root}/collections/${collection}/insert`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': row.orgId,
        },
        body: JSON.stringify({ id: row.id, data: row }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return row;
    },

    async getByDeliveryId(orgId, deliveryId) {
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': orgId,
        },
        body: JSON.stringify({
          where: { deliveryId },
          limit: 1,
        }),
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
      return parseRow(doc.id, doc.data ?? {}) ?? undefined;
    },

    async getById(orgId, id) {
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': orgId,
        },
        body: JSON.stringify({
          where: { id },
          limit: 1,
        }),
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
      const row = parseRow(doc.id, doc.data ?? {});
      if (!row || row.orgId !== orgId) return undefined;
      return row;
    },

    async list(query) {
      const limit = Math.min(
        Math.max(query.limit ?? MESSAGES_PAGE_MAX, 1),
        MESSAGES_PAGE_MAX,
      );
      const offset = Math.max(query.offset ?? 0, 0);
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': query.orgId,
        },
        body: JSON.stringify({
          limit: 500,
          orderBy: [{ field: 'receivedAt', direction: 'desc' }],
        }),
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
      const rows = docs
        .map((doc) => parseRow(doc.id, doc.data ?? {}))
        .filter((r): r is InboundMessage => r !== null)
        .filter((r) => r.orgId === query.orgId)
        .filter((r) => matchesFilters(r, query))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
      return rows.slice(offset, offset + limit);
    },

    async markRead(orgId, id) {
      const current = await this.getById(orgId, id);
      if (!current) return undefined;
      if (current.readAt) return current;
      const updated: InboundMessage = {
        ...current,
        readAt: new Date().toISOString(),
      };
      const res = await fetch(`${root}/collections/${collection}/update`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agentos-org-id': orgId,
        },
        body: JSON.stringify({ id: updated.id, data: updated }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store update failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return updated;
    },
  };
}
