import {
  DEFAULT_MOUNT_ALIAS,
  PLATFORM_MOUNT_ID,
} from '@agentos/core/api/files-ref';

import type { FilesMountStore } from './mount-store';
import type { FilesMount, MountRecord, MountViewer } from './mount-types';
import type {
  StorageProviderContext,
  StorageProviderRegistry,
} from './storage-providers';
import type { StorageAdapter } from './types';

export const PLATFORM_MOUNT_NAME = 'Platform storage';

export type MountResolver = {
  /** Mounts visible to the viewer (platform first). */
  list: (orgId: string, viewer: MountViewer) => Promise<FilesMount[]>;
  /** Visible mount by id (`default` → org default upload mount). */
  get: (
    orgId: string,
    id: string,
    viewer: MountViewer,
  ) => Promise<FilesMount | undefined>;
  adapter: (
    orgId: string,
    mount: FilesMount,
    draftSecrets?: Record<string, string>,
  ) => Promise<StorageAdapter>;
  /** Raw persisted records (no visibility filter). */
  records: (orgId: string) => Promise<MountRecord[]>;
  store?: FilesMountStore;
  providers?: StorageProviderRegistry;
};

export type CreateMountResolverOptions = {
  platform: StorageAdapter;
  store?: FilesMountStore;
  providers?: StorageProviderRegistry;
  runtimeEnv?: Record<string, string | undefined>;
};

export function isVisibleMount(
  mount: FilesMount,
  viewer: MountViewer,
): boolean {
  if (mount.kind !== 'personal') return true;
  return Boolean(viewer.userId) && mount.ownerUserId === viewer.userId;
}

function platformMount(
  adapter: StorageAdapter,
  override: MountRecord | undefined,
  isDefault: boolean,
): FilesMount {
  return {
    id: PLATFORM_MOUNT_ID,
    kind: 'org',
    provider: adapter.provider,
    name: override?.name || PLATFORM_MOUNT_NAME,
    isDefault,
    status: 'connected',
    builtin: true,
    ...(override?.updatedAt ? { updatedAt: override.updatedAt } : {}),
  };
}

/** Compose the built-in platform mount with persisted org / personal mounts. */
export function composeMounts(
  adapter: StorageAdapter,
  records: MountRecord[],
): FilesMount[] {
  const platformOverride = records.find((r) => r.id === PLATFORM_MOUNT_ID);
  const others = records.filter((r) => r.id !== PLATFORM_MOUNT_ID);
  const defaultOrg = others.find((r) => r.kind === 'org' && r.isDefault);
  const mounts: FilesMount[] = [
    platformMount(adapter, platformOverride, !defaultOrg),
  ];
  for (const record of others) {
    mounts.push({
      ...record,
      isDefault: record.kind === 'org' && record.id === defaultOrg?.id,
    });
  }
  return mounts;
}

export function createMountResolver(
  options: CreateMountResolverOptions,
): MountResolver {
  const adapters = new Map<string, StorageAdapter>();

  async function records(orgId: string): Promise<MountRecord[]> {
    if (!options.store) return [];
    try {
      return await options.store.list(orgId);
    } catch {
      return [];
    }
  }

  async function all(orgId: string): Promise<FilesMount[]> {
    return composeMounts(options.platform, await records(orgId));
  }

  return {
    store: options.store,
    providers: options.providers,
    records,

    async list(orgId, viewer) {
      return (await all(orgId)).filter((m) => isVisibleMount(m, viewer));
    },

    async get(orgId, id, viewer) {
      const mounts = await all(orgId);
      const mount =
        id === DEFAULT_MOUNT_ALIAS
          ? mounts.find((m) => m.isDefault)
          : mounts.find((m) => m.id === id);
      if (!mount || !isVisibleMount(mount, viewer)) return undefined;
      return mount;
    },

    async adapter(orgId, mount, draftSecrets) {
      if (mount.id === PLATFORM_MOUNT_ID) return options.platform;
      const cacheKey = `${orgId}:${mount.id}:${mount.updatedAt ?? ''}`;
      const cached = draftSecrets ? undefined : adapters.get(cacheKey);
      if (cached) return cached;
      const provider = options.providers?.get(mount.provider);
      if (!provider) {
        throw new MountUnavailableError(
          `storage provider not available: ${mount.provider}`,
        );
      }
      const stored =
        (await options.store?.secrets?.(orgId, mount.id).catch(() => ({}))) ??
        {};
      const ctx: StorageProviderContext = {
        orgId,
        runtimeEnv: options.runtimeEnv,
        secrets: { ...stored, ...draftSecrets },
      };
      const adapter = await provider.create(mount, ctx);
      if (draftSecrets) return adapter;
      for (const key of adapters.keys()) {
        if (key.startsWith(`${orgId}:${mount.id}:`)) adapters.delete(key);
      }
      adapters.set(cacheKey, adapter);
      return adapter;
    },
  };
}

export class MountUnavailableError extends Error {
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = 'MountUnavailableError';
  }
}
