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
  /**
   * Provision the org's `<slug>@<domain>` address once (purpose `default`).
   * A slug taken by another org gets an org-id suffix.
   */
  ensureDefault: (input: {
    orgId: string;
    orgName?: string;
    domain: string;
  }) => Promise<InboundAddress | undefined>;
};

export const DEFAULT_ADDRESS_PURPOSE = 'default';

/** Mailbox-safe local part from the org name, else from the org id. */
export function orgAddressSlug(orgName: string | undefined, orgId: string) {
  const fromName = (orgName ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  if (fromName) return fromName;
  const compact = orgId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `org-${compact.slice(0, 12) || 'unknown'}`;
}

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
  const ensured = new Map<string, InboundAddress>();
  const store: AddressStore = {
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

    async ensureDefault({ orgId, orgName, domain }) {
      const host = domain.trim().toLowerCase().replace(/^@/, '');
      if (!host) return undefined;
      const cached = ensured.get(orgId);
      if (cached?.address.endsWith(`@${host}`)) return cached;
      const rows = await store.list(orgId);
      const existing = rows.find(
        (r) =>
          r.purpose === DEFAULT_ADDRESS_PURPOSE &&
          r.address.endsWith(`@${host}`),
      );
      if (existing) {
        ensured.set(orgId, existing);
        return existing;
      }
      const slug = orgAddressSlug(orgName, orgId);
      const suffix = orgId
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 6);
      for (const local of [slug, `${slug}-${suffix}`]) {
        const address = `${local}@${host}`;
        const taken = await db.findByAddress(address).catch(() => undefined);
        if (taken && taken.orgId !== orgId) continue;
        const row =
          taken ??
          (await db.insertAddress({
            id: crypto.randomUUID(),
            address,
            orgId,
            purpose: DEFAULT_ADDRESS_PURPOSE,
            createdAt: new Date().toISOString(),
          }));
        ensured.set(orgId, row);
        return row;
      }
      return undefined;
    },
  };
  return store;
}
