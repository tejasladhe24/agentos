import type { IntegrationsKit } from '@agentos/core/api/integrations';

import { FILES_MOUNT_INTEGRATION } from './constants';
import type { MountRecord, MountStatus } from './mount-types';

/** Persistence for org / personal mount records. */
export type FilesMountStore = {
  list: (orgId: string) => Promise<MountRecord[]>;
  put: (
    orgId: string,
    record: MountRecord,
    options?: PutMountOptions,
  ) => Promise<MountRecord>;
  delete: (orgId: string, id: string, actor?: string) => Promise<boolean>;
  /** Decrypted secret config for adapter construction. */
  secrets?: (orgId: string, id: string) => Promise<Record<string, string>>;
};

const STATUSES: ReadonlySet<MountStatus> = new Set([
  'connected',
  'disconnected',
  'error',
]);

export function parseMountRecord(
  id: string,
  data: Record<string, unknown>,
): MountRecord | null {
  const mountId = typeof data.id === 'string' ? data.id : id;
  if (!mountId || typeof data.provider !== 'string') return null;
  const record: MountRecord = {
    id: mountId,
    kind: data.kind === 'personal' ? 'personal' : 'org',
    provider: data.provider,
    name: typeof data.name === 'string' && data.name ? data.name : mountId,
    isDefault: data.isDefault === true,
    status: STATUSES.has(data.status as MountStatus)
      ? (data.status as MountStatus)
      : 'connected',
  };
  if (typeof data.ownerUserId === 'string') {
    record.ownerUserId = data.ownerUserId;
  }
  if (data.config && typeof data.config === 'object') {
    record.config = data.config as Record<string, unknown>;
  }
  if (typeof data.statusMessage === 'string') {
    record.statusMessage = data.statusMessage;
  }
  if (typeof data.createdAt === 'string') record.createdAt = data.createdAt;
  if (typeof data.updatedAt === 'string') record.updatedAt = data.updatedAt;
  return record;
}

export type PutMountOptions = {
  /** Secret config fields → vault. Omitted keep their value; `null` removes. */
  secrets?: Record<string, string | null>;
  actor?: string;
};

function toSettings(record: MountRecord): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    kind: record.kind,
    name: record.name,
    isDefault: record.isDefault,
    status: record.status,
  };
  if (record.ownerUserId) settings.ownerUserId = record.ownerUserId;
  if (record.statusMessage) settings.statusMessage = record.statusMessage;
  if (record.config) settings.config = record.config;
  return settings;
}

/** Mounts as `files.mount` integration instances (instance id = mount id). */
export function createIntegrationsMountStore(
  kit: IntegrationsKit,
): FilesMountStore {
  return {
    async list(orgId) {
      const views = await kit.listIntegrations(orgId, FILES_MOUNT_INTEGRATION);
      const out: MountRecord[] = [];
      for (const view of views) {
        const record = parseMountRecord(view.instanceId, {
          ...view.settings,
          id: view.instanceId,
          provider: view.provider,
          createdAt: view.createdAt,
          updatedAt: view.updatedAt,
        });
        if (record) out.push(record);
      }
      return out;
    },

    async put(orgId, record, options = {}) {
      const view = await kit.putIntegration(orgId, {
        integration: FILES_MOUNT_INTEGRATION,
        instanceId: record.id,
        provider: record.provider,
        settings: toSettings(record),
        ...(options.secrets ? { secrets: options.secrets } : {}),
        ...(options.actor ? { updatedBy: options.actor } : {}),
      });
      return {
        ...record,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
      };
    },

    async delete(orgId, id, actor) {
      const { deleted } = await kit.deleteIntegration(
        orgId,
        FILES_MOUNT_INTEGRATION,
        id,
        actor,
      );
      return deleted;
    },

    async secrets(orgId, id) {
      const resolved = await kit.getIntegration(
        orgId,
        FILES_MOUNT_INTEGRATION,
        id,
      );
      return resolved?.secrets ?? {};
    },
  };
}

/** In-memory mount store for unit tests. */
export function createMemoryMountStore(): FilesMountStore {
  const byOrg = new Map<string, Map<string, MountRecord>>();
  const vault = new Map<string, Record<string, string>>();
  function orgMap(orgId: string): Map<string, MountRecord> {
    let map = byOrg.get(orgId);
    if (!map) {
      map = new Map();
      byOrg.set(orgId, map);
    }
    return map;
  }
  return {
    async list(orgId) {
      return [...orgMap(orgId).values()].map((r) => ({ ...r }));
    },
    async put(orgId, record, options = {}) {
      orgMap(orgId).set(record.id, { ...record });
      const key = `${orgId}:${record.id}`;
      const next = { ...vault.get(key) };
      for (const [field, value] of Object.entries(options.secrets ?? {})) {
        if (value === null) delete next[field];
        else next[field] = value;
      }
      vault.set(key, next);
      return record;
    },
    async delete(orgId, id) {
      vault.delete(`${orgId}:${id}`);
      return orgMap(orgId).delete(id);
    },
    async secrets(orgId, id) {
      return { ...vault.get(`${orgId}:${id}`) };
    },
  };
}
