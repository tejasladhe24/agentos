import { NOTIFICATIONS_COLLECTION } from './constants';

export type NotificationType = 'info' | 'success' | 'error';
export type DeliveryChannel = 'in_app' | 'email' | 'sms';
export type DeliveryStatus = 'queued' | 'sent' | 'failed';

export type NotificationEntry = {
  id: string;
  message: string;
  type: NotificationType;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  at: string;
  to?: string;
  templateId?: string;
  subject?: string;
  orgId?: string;
  provider?: string;
  error?: string;
  sentAt?: string;
};

export type DbStoreClient = {
  insert: (entry: NotificationEntry) => Promise<NotificationEntry>;
  query: () => Promise<NotificationEntry[]>;
  get: (id: string) => Promise<NotificationEntry | undefined>;
  update: (entry: NotificationEntry) => Promise<NotificationEntry>;
  delete: (ids: string[]) => Promise<number>;
};

function parseChannel(value: unknown): DeliveryChannel {
  if (value === 'email' || value === 'sms' || value === 'in_app') return value;
  return 'in_app';
}

function parseStatus(value: unknown): DeliveryStatus {
  if (value === 'queued' || value === 'sent' || value === 'failed')
    return value;
  // Legacy inbox rows (ticket 61) had no status — treat as delivered toast.
  return 'sent';
}

function parseEntry(
  id: string,
  data: Record<string, unknown>,
): NotificationEntry | null {
  const message = typeof data.message === 'string' ? data.message : '';
  const type = data.type;
  if (!message || (type !== 'info' && type !== 'success' && type !== 'error')) {
    return null;
  }
  const entry: NotificationEntry = {
    id: typeof data.id === 'string' ? data.id : id,
    message,
    type,
    channel: parseChannel(data.channel),
    status: parseStatus(data.status),
    at: typeof data.at === 'string' ? data.at : new Date(0).toISOString(),
  };
  if (typeof data.to === 'string') entry.to = data.to;
  if (typeof data.templateId === 'string') entry.templateId = data.templateId;
  if (typeof data.subject === 'string') entry.subject = data.subject;
  if (typeof data.orgId === 'string') entry.orgId = data.orgId;
  if (typeof data.provider === 'string') entry.provider = data.provider;
  if (typeof data.error === 'string') entry.error = data.error;
  if (typeof data.sentAt === 'string') entry.sentAt = data.sentAt;
  return entry;
}

export function createDbStoreClient(baseUrl: string): DbStoreClient {
  const root = baseUrl.replace(/\/+$/, '');
  const collection = encodeURIComponent(NOTIFICATIONS_COLLECTION);

  return {
    async insert(entry) {
      const res = await fetch(`${root}/collections/${collection}/insert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: entry.id, data: entry }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return entry;
    },

    async query() {
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 500 }),
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
        .map((doc) => parseEntry(doc.id, doc.data ?? {}))
        .filter((e): e is NotificationEntry => e !== null)
        .sort((a, b) => b.at.localeCompare(a.at));
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
      return parseEntry(doc.id, doc.data ?? {}) ?? undefined;
    },

    async update(entry) {
      const res = await fetch(`${root}/collections/${collection}/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: entry.id, data: entry }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store update failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return entry;
    },

    async delete(ids) {
      if (ids.length === 0) return 0;
      const res = await fetch(`${root}/collections/${collection}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store delete failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const body = (await res.json()) as { deleted?: number };
      return typeof body.deleted === 'number' ? body.deleted : ids.length;
    },
  };
}
