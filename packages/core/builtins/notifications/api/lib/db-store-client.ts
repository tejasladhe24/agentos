import { NOTIFICATIONS_COLLECTION } from './constants';

export type NotificationType = 'info' | 'success' | 'error';

export type NotificationEntry = {
  id: string;
  message: string;
  type: NotificationType;
  at: string;
};

export type DbStoreClient = {
  insert: (entry: NotificationEntry) => Promise<NotificationEntry>;
  query: () => Promise<NotificationEntry[]>;
  delete: (ids: string[]) => Promise<number>;
};

function parseEntry(
  id: string,
  data: Record<string, unknown>,
): NotificationEntry | null {
  const message = typeof data.message === 'string' ? data.message : '';
  const type = data.type;
  if (!message || (type !== 'info' && type !== 'success' && type !== 'error')) {
    return null;
  }
  return {
    id: typeof data.id === 'string' ? data.id : id,
    message,
    type,
    at: typeof data.at === 'string' ? data.at : new Date(0).toISOString(),
  };
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
