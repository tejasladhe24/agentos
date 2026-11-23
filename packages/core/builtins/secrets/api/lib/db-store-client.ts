import { ORG_ID_HEADER, SECRETS_ALG, SECRETS_COLLECTION } from './constants';

export type VaultRecord = {
  key: string;
  ciphertext: string;
  iv: string;
  alg: typeof SECRETS_ALG;
  rotatedAt: string;
  version: number;
  expiresAt?: string;
  orgId?: string;
};

export type SecretsDbStoreClient = {
  get: (orgId: string, key: string) => Promise<VaultRecord | undefined>;
  put: (orgId: string, record: VaultRecord) => Promise<VaultRecord>;
  delete: (orgId: string, key: string) => Promise<boolean>;
};

function parseRecord(
  id: string,
  data: Record<string, unknown>,
): VaultRecord | null {
  const key = typeof data.key === 'string' ? data.key : id;
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
      const doc = payload.items?.[0];
      if (!doc) return undefined;
      return parseRecord(doc.id, doc.data ?? {}) ?? undefined;
    },

    async put(orgId, record) {
      const existing = await this.get(orgId, record.key);
      const data: Record<string, unknown> = {
        key: record.key,
        ciphertext: record.ciphertext,
        iv: record.iv,
        alg: record.alg,
        rotatedAt: record.rotatedAt,
        version: record.version,
      };
      if (record.expiresAt) data.expiresAt = record.expiresAt;

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
  };
}
