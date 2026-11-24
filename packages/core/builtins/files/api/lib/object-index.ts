import { FILES_OBJECTS_COLLECTION, ORG_ID_HEADER } from './constants';

export type ObjectMetaRecord = {
  /** Legacy absolute key for the platform mount; `files://…` ref otherwise. */
  key: string;
  /** Owning mount; absent on pre-mount records (backfilled as `platform`). */
  mountId?: string;
  name: string;
  bytes: number;
  contentType: string;
  updatedAt: string;
  /** Soft-delete / bin metadata (absent when live). */
  trashedAt?: string;
  /** ISO timestamp when bin item is permanently deleted; null = keep forever. */
  purgeAt?: string | null;
  /** Live absolute key before trash (for restore). */
  originalKey?: string;
};

export type FilesObjectIndex = {
  get: (orgId: string, key: string) => Promise<ObjectMetaRecord | undefined>;
  put: (orgId: string, record: ObjectMetaRecord) => Promise<ObjectMetaRecord>;
  delete: (orgId: string, key: string) => Promise<boolean>;
  /** Query by key prefix (for enrich / search). */
  listByPrefix: (
    orgId: string,
    prefix: string,
    limit?: number,
  ) => Promise<ObjectMetaRecord[]>;
  searchByName: (
    orgId: string,
    query: string,
    limit?: number,
  ) => Promise<ObjectMetaRecord[]>;
};

function orgHeaders(orgId: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(ORG_ID_HEADER, orgId);
  return headers;
}

function parseRecord(
  id: string,
  data: Record<string, unknown>,
): ObjectMetaRecord | null {
  const key = typeof data.key === 'string' ? data.key : id;
  const name = typeof data.name === 'string' ? data.name : '';
  const bytes =
    typeof data.bytes === 'number' && Number.isFinite(data.bytes)
      ? Math.max(0, Math.floor(data.bytes))
      : 0;
  const contentType =
    typeof data.contentType === 'string' && data.contentType
      ? data.contentType
      : 'application/octet-stream';
  const updatedAt =
    typeof data.updatedAt === 'string'
      ? data.updatedAt
      : new Date(0).toISOString();
  if (!key) return null;
  const record: ObjectMetaRecord = {
    key,
    name: name || key.split('/').pop() || key,
    bytes,
    contentType,
    updatedAt,
  };
  if (typeof data.mountId === 'string' && data.mountId) {
    record.mountId = data.mountId;
  }
  if (typeof data.trashedAt === 'string') record.trashedAt = data.trashedAt;
  if (data.purgeAt === null) record.purgeAt = null;
  else if (typeof data.purgeAt === 'string') record.purgeAt = data.purgeAt;
  if (typeof data.originalKey === 'string') {
    record.originalKey = data.originalKey;
  }
  return record;
}

/**
 * Thin HTTP client for org-scoped `files_objects` documents in db-store.
 */
export function createFilesObjectIndex(baseUrl: string): FilesObjectIndex {
  const root = baseUrl.replace(/\/+$/, '');
  const collection = encodeURIComponent(FILES_OBJECTS_COLLECTION);

  return {
    async get(orgId, key) {
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ where: { key }, limit: 1 }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store query failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const payload = (await res.json()) as {
        items?: Array<{ id: string; data: Record<string, unknown> }>;
      };
      const item = payload.items?.[0];
      if (!item) return undefined;
      return parseRecord(item.id, item.data ?? {}) ?? undefined;
    },

    async put(orgId, record) {
      const existing = await this.get(orgId, record.key);
      const data: Record<string, unknown> = {
        key: record.key,
        name: record.name,
        bytes: record.bytes,
        contentType: record.contentType,
        updatedAt: record.updatedAt,
      };
      if (record.mountId !== undefined) data.mountId = record.mountId;
      if (record.trashedAt !== undefined) data.trashedAt = record.trashedAt;
      if (record.purgeAt !== undefined) data.purgeAt = record.purgeAt;
      if (record.originalKey !== undefined) {
        data.originalKey = record.originalKey;
      }

      if (existing) {
        const res = await fetch(`${root}/collections/${collection}/update`, {
          method: 'POST',
          headers: orgHeaders(orgId),
          body: JSON.stringify({
            id: record.key,
            data,
            merge: false,
          }),
        });
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(
            `db-store update failed (${res.status}): ${detail || res.statusText}`,
          );
        }
        return record;
      }

      const res = await fetch(`${root}/collections/${collection}/insert`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ id: record.key, data }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return record;
    },

    async delete(orgId, key) {
      const res = await fetch(`${root}/collections/${collection}/delete`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ id: key }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store delete failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const body = (await res.json()) as { deleted?: number };
      return (body.deleted ?? 0) > 0;
    },

    async listByPrefix(orgId, prefix, limit = 500) {
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ limit: Math.max(limit, 500) }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store query failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      const payload = (await res.json()) as {
        items?: Array<{ id: string; data: Record<string, unknown> }>;
      };
      const items: ObjectMetaRecord[] = [];
      for (const item of payload.items ?? []) {
        const record = parseRecord(item.id, item.data ?? {});
        if (!record) continue;
        if (prefix && !record.key.startsWith(prefix)) continue;
        items.push(record);
        if (items.length >= limit) break;
      }
      return items;
    },

    async searchByName(orgId, query, limit = 100) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const all = await this.listByPrefix(orgId, '', 2000);
      return all
        .filter((r) => r.name.toLowerCase().includes(q))
        .slice(0, limit);
    },
  };
}

/** In-memory index for unit tests. */
export function createMemoryObjectIndex(): FilesObjectIndex {
  const byOrg = new Map<string, Map<string, ObjectMetaRecord>>();

  function orgMap(orgId: string): Map<string, ObjectMetaRecord> {
    let map = byOrg.get(orgId);
    if (!map) {
      map = new Map();
      byOrg.set(orgId, map);
    }
    return map;
  }

  return {
    async get(orgId, key) {
      return orgMap(orgId).get(key);
    },
    async put(orgId, record) {
      orgMap(orgId).set(record.key, record);
      return record;
    },
    async delete(orgId, key) {
      return orgMap(orgId).delete(key);
    },
    async listByPrefix(orgId, prefix, limit = 500) {
      const out: ObjectMetaRecord[] = [];
      for (const record of orgMap(orgId).values()) {
        if (prefix && !record.key.startsWith(prefix)) continue;
        out.push(record);
        if (out.length >= limit) break;
      }
      return out;
    },
    async searchByName(orgId, query, limit = 100) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const out: ObjectMetaRecord[] = [];
      for (const record of orgMap(orgId).values()) {
        if (!record.name.toLowerCase().includes(q)) continue;
        out.push(record);
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}
