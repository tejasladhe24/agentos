import {
  ORG_ID_HEADER,
  SECRETS_ALG,
  SECRETS_COLLECTION,
  SECRETS_LIST_LIMIT,
  USER_OWNED_KEY_PREFIX,
} from './constants';

export type VaultRecord = {
  key: string;
  ciphertext: string;
  iv: string;
  alg: typeof SECRETS_ALG;
  rotatedAt: string;
  version: number;
  expiresAt?: string;
  orgId?: string;
  /** Set → readable only by this user (or a service acting for them). */
  ownerUserId?: string;
};

export type SecretsDbStoreClient = {
  /** `ownerUserId` omitted → org-owned row only. */
  get: (
    orgId: string,
    key: string,
    ownerUserId?: string,
  ) => Promise<VaultRecord | undefined>;
  /** All rows for the org, including user-owned (callers filter). */
  list: (orgId: string) => Promise<VaultRecord[]>;
  listOwnedBy: (orgId: string, ownerUserId: string) => Promise<VaultRecord[]>;
  put: (orgId: string, record: VaultRecord) => Promise<VaultRecord>;
  delete: (
    orgId: string,
    key: string,
    ownerUserId?: string,
  ) => Promise<boolean>;
};

/**
 * db-store row id / `data.key` for a vault record. User-owned rows are
 * namespaced so org-scoped `where: { key }` lookups can never match them.
 */
export function vaultStorageKey(key: string, ownerUserId?: string): string {
  if (!ownerUserId) return key;
  return `${USER_OWNED_KEY_PREFIX}${encodeURIComponent(ownerUserId)}/${key}`;
}

function logicalKey(storageKey: string, ownerUserId?: string): string {
  if (!ownerUserId) return storageKey;
  const prefix = vaultStorageKey('', ownerUserId);
  return storageKey.startsWith(prefix)
    ? storageKey.slice(prefix.length)
    : storageKey;
}

function parseRecord(
  id: string,
  data: Record<string, unknown>,
): VaultRecord | null {
  const ownerUserId =
    typeof data.ownerUserId === 'string' && data.ownerUserId
      ? data.ownerUserId
      : undefined;
  const key = logicalKey(
    typeof data.key === 'string' ? data.key : id,
    ownerUserId,
  );
  const ciphertext = typeof data.ciphertext === 'string' ? data.ciphertext : '';
  const iv = typeof data.iv === 'string' ? data.iv : '';
  const alg = data.alg;
  const rotatedAt = typeof data.rotatedAt === 'string' ? data.rotatedAt : '';
  const version =
    typeof data.version === 'number' && Number.isFinite(data.version)
      ? Math.floor(data.version)
      : 0;
  if (!key || !ciphertext || !iv || alg !== SECRETS_ALG || !rotatedAt) {
    return null;
  }
  const record: VaultRecord = {
    key,
    ciphertext,
    iv,
    alg: SECRETS_ALG,
    rotatedAt,
    version,
  };
  if (typeof data.expiresAt === 'string') record.expiresAt = data.expiresAt;
  if (typeof data.orgId === 'string') record.orgId = data.orgId;
  if (ownerUserId) record.ownerUserId = ownerUserId;
  return record;
}

function orgHeaders(orgId: string): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(ORG_ID_HEADER, orgId);
  return headers;
}

/**
 * Thin HTTP client for org-scoped `secrets_vault` documents in db-store.
 * Ciphertext only — never plaintext.
 */
export function createSecretsDbStoreClient(
  baseUrl: string,
): SecretsDbStoreClient {
  const root = baseUrl.replace(/\/+$/, '');
  const collection = encodeURIComponent(SECRETS_COLLECTION);

  return {
    async get(orgId, key, ownerUserId) {
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({
          where: { key: vaultStorageKey(key, ownerUserId) },
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
      };
      const doc = payload.items?.[0];
      if (!doc) return undefined;
      const record = parseRecord(doc.id, doc.data ?? {});
      if (!record || record.ownerUserId !== ownerUserId) return undefined;
      return record;
    },

    async list(orgId) {
      return queryRecords(orgId, { limit: SECRETS_LIST_LIMIT });
    },

    async listOwnedBy(orgId, ownerUserId) {
      return queryRecords(orgId, {
        where: { ownerUserId },
        limit: SECRETS_LIST_LIMIT,
      });
    },

    async put(orgId, record) {
      const existing = await this.get(orgId, record.key, record.ownerUserId);
      const storageKey = vaultStorageKey(record.key, record.ownerUserId);
      const data: Record<string, unknown> = {
        key: storageKey,
        ciphertext: record.ciphertext,
        iv: record.iv,
        alg: record.alg,
        rotatedAt: record.rotatedAt,
        version: record.version,
      };
      if (record.expiresAt) data.expiresAt = record.expiresAt;
      if (record.ownerUserId) data.ownerUserId = record.ownerUserId;

      if (existing) {
        const res = await fetch(`${root}/collections/${collection}/update`, {
          method: 'POST',
          headers: orgHeaders(orgId),
          body: JSON.stringify({
            id: storageKey,
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
        body: JSON.stringify({ id: storageKey, data }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(
          `db-store insert failed (${res.status}): ${detail || res.statusText}`,
        );
      }
      return record;
    },

    async delete(orgId, key, ownerUserId) {
      const res = await fetch(`${root}/collections/${collection}/delete`, {
        method: 'POST',
        headers: orgHeaders(orgId),
        body: JSON.stringify({ id: vaultStorageKey(key, ownerUserId) }),
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
  };

  async function queryRecords(
    orgId: string,
    query: Record<string, unknown>,
  ): Promise<VaultRecord[]> {
    const res = await fetch(`${root}/collections/${collection}/query`, {
      method: 'POST',
      headers: orgHeaders(orgId),
      body: JSON.stringify(query),
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
    const records: VaultRecord[] = [];
    for (const doc of payload.items ?? []) {
      const record = parseRecord(doc.id, doc.data ?? {});
      if (record) records.push(record);
    }
    return records;
  }
}
