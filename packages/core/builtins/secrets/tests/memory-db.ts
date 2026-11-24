import {
  vaultStorageKey,
  type SecretsDbStoreClient,
  type VaultRecord,
} from '@agentos/core/builtins/secrets/api/lib/db-store-client';

/** In-memory vault keyed like db-store (`org::storageKey`). */
export function memoryDb(): SecretsDbStoreClient & {
  rows: Map<string, VaultRecord>;
} {
  const rows = new Map<string, VaultRecord>();
  const id = (orgId: string, key: string, ownerUserId?: string) =>
    `${orgId}::${vaultStorageKey(key, ownerUserId)}`;
  return {
    rows,
    async get(orgId, key, ownerUserId) {
      return rows.get(id(orgId, key, ownerUserId));
    },
    async list(orgId) {
      const prefix = `${orgId}::`;
      const out: VaultRecord[] = [];
      for (const [rowId, record] of rows) {
        if (rowId.startsWith(prefix)) out.push(record);
      }
      return out;
    },
    async listOwnedBy(orgId, ownerUserId) {
      return (await this.list(orgId)).filter(
        (record) => record.ownerUserId === ownerUserId,
      );
    },
    async put(orgId, record) {
      const stored = { ...record, orgId };
      rows.set(id(orgId, record.key, record.ownerUserId), stored);
      return stored;
    },
    async delete(orgId, key, ownerUserId) {
      return rows.delete(id(orgId, key, ownerUserId));
    },
  };
}
