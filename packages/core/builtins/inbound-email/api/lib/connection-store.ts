import { CONNECTIONS_COLLECTION } from './constants';

/** Opaque BYOK webhook connection → owning org + integration instance. */
export type InboundConnection = {
  connectionId: string;
  orgId: string;
  integration: string;
  instanceId: string;
  createdAt: string;
};

export type ConnectionStore = {
  get: (connectionId: string) => Promise<InboundConnection | undefined>;
  put: (row: InboundConnection) => Promise<void>;
  remove: (connectionId: string) => Promise<void>;
};

const CONNECTION_ID_RE = /^rc_[a-f0-9]{32}$/;

export function newConnectionId(): string {
  return `rc_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function isValidConnectionId(value: string): boolean {
  return CONNECTION_ID_RE.test(value);
}

function parseRow(data: Record<string, unknown>): InboundConnection | null {
  const str = (key: string) =>
    typeof data[key] === 'string' ? (data[key] as string) : '';
  if (!str('connectionId') || !str('orgId')) return null;
  return {
    connectionId: str('connectionId'),
    orgId: str('orgId'),
    integration: str('integration'),
    instanceId: str('instanceId'),
    createdAt: str('createdAt') || new Date(0).toISOString(),
  };
}

export function createConnectionStore(baseUrl: string): ConnectionStore {
  const root = `${baseUrl.replace(/\/+$/, '')}/collections/${encodeURIComponent(CONNECTIONS_COLLECTION)}`;
  const post = (action: string, body: unknown) =>
    fetch(`${root}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    async get(connectionId) {
      const res = await post('query', { where: { connectionId }, limit: 1 });
      if (!res.ok) {
        throw new Error(`db-store query failed (${res.status})`);
      }
      const payload = (await res.json()) as {
        items?: Array<{ data: Record<string, unknown> }>;
        documents?: Array<{ data: Record<string, unknown> }>;
      };
      const doc = (payload.items ?? payload.documents ?? [])[0];
      return doc ? (parseRow(doc.data ?? {}) ?? undefined) : undefined;
    },
    async put(row) {
      const res = await post('insert', { id: row.connectionId, data: row });
      if (!res.ok && res.status !== 409) {
        throw new Error(`db-store insert failed (${res.status})`);
      }
    },
    async remove(connectionId) {
      const res = await post('delete', { id: connectionId });
      if (!res.ok && res.status !== 404) {
        throw new Error(`db-store delete failed (${res.status})`);
      }
    },
  };
}

export function createMemoryConnectionStore(): ConnectionStore & {
  rows: Map<string, InboundConnection>;
} {
  const rows = new Map<string, InboundConnection>();
  return {
    rows,
    async get(connectionId) {
      return rows.get(connectionId);
    },
    async put(row) {
      if (!rows.has(row.connectionId)) rows.set(row.connectionId, row);
    },
    async remove(connectionId) {
      rows.delete(connectionId);
    },
  };
}
