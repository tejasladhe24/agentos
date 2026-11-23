import { ADDRESSES_COLLECTION } from './constants';
import { normalizeAddress } from './http';
import type { InboundAddress } from './types';

export type AddressDb = {
  insertAddress: (row: InboundAddress) => Promise<InboundAddress>;
  listAddresses: () => Promise<InboundAddress[]>;
  findByAddress: (address: string) => Promise<InboundAddress | undefined>;
};

export type AddressStore = {
  resolveOrgId: (recipients: string[]) => Promise<string | undefined>;
  provision: (input: {
    address: string;
    orgId: string;
    purpose?: string;
  }) => Promise<InboundAddress>;
  list: (orgId?: string) => Promise<InboundAddress[]>;
};

function parseRow(
  id: string,
  data: Record<string, unknown>,
): InboundAddress | null {
  const address = typeof data.address === 'string' ? data.address : '';
  const orgId = typeof data.orgId === 'string' ? data.orgId : '';
  if (!address || !orgId) return null;
  return {
    id: typeof data.id === 'string' ? data.id : id,
    address: normalizeAddress(address),
    orgId,
    purpose: typeof data.purpose === 'string' ? data.purpose : undefined,
    createdAt:
      typeof data.createdAt === 'string'
        ? data.createdAt
        : new Date(0).toISOString(),
  };
}

export function createAddressDb(baseUrl: string): AddressDb {
  const root = baseUrl.replace(/\/+$/, '');
  const collection = encodeURIComponent(ADDRESSES_COLLECTION);

  return {
    async insertAddress(row) {
      const res = await fetch(`${root}/collections/${collection}/insert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

    async listAddresses() {
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
        .map((doc) => parseRow(doc.id, doc.data ?? {}))
        .filter((r): r is InboundAddress => r !== null);
    },

    async findByAddress(address) {
      const normalized = normalizeAddress(address);
      const res = await fetch(`${root}/collections/${collection}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          where: { address: normalized },
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

export function createAddressStore(
  db: AddressDb,
  envMap: Map<string, string> = new Map(),
): AddressStore {
  return {
    async resolveOrgId(recipients) {
      for (const raw of recipients) {
        const address = normalizeAddress(raw);
        const fromEnv = envMap.get(address);
        if (fromEnv) return fromEnv;
        try {
          const row = await db.findByAddress(address);
          if (row) return row.orgId;
        } catch {
          // fall through — env map may still resolve other recipients
        }
      }
      return undefined;
    },

    async provision(input) {
      const address = normalizeAddress(input.address);
      const existing = await db.findByAddress(address).catch(() => undefined);
      if (existing) {
        if (existing.orgId !== input.orgId) {
          throw new Error('address already mapped to another org');
        }
        return existing;
      }
      const row: InboundAddress = {
        id: crypto.randomUUID(),
        address,
        orgId: input.orgId,
        purpose: input.purpose,
        createdAt: new Date().toISOString(),
      };
      return db.insertAddress(row);
    },

    async list(orgId) {
      const rows = await db.listAddresses().catch(() => [] as InboundAddress[]);
      const seen = new Set(rows.map((r) => r.address));
      const merged = [...rows];
      for (const [address, mappedOrgId] of envMap) {
        if (seen.has(address)) continue;
        merged.push({
          id: `env:${address}`,
          address,
          orgId: mappedOrgId,
          purpose: 'env',
          createdAt: new Date(0).toISOString(),
        });
      }
      const filtered =
        typeof orgId === 'string' && orgId.length > 0
          ? merged.filter((row) => row.orgId === orgId)
          : merged;
      return filtered.sort((a, b) => a.address.localeCompare(b.address));
    },
  };
}
