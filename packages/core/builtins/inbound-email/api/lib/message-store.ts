import { MESSAGES_COLLECTION } from './constants';
import type { InboundMessage, StoredAttachment } from './types';

export type MessageDb = {
  insertMessage: (row: InboundMessage) => Promise<InboundMessage>;
  getByDeliveryId: (
    orgId: string,
    deliveryId: string,
  ) => Promise<InboundMessage | undefined>;
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
  return {
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
  };
}
