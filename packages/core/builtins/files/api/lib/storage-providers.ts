import type { FilesMount } from './mount-types';
import type { StorageAdapter } from './types';

export type StorageProviderContext = {
  orgId: string;
  runtimeEnv?: Record<string, string | undefined>;
  /** Decrypted secret config fields from the vault (credentials, tokens). */
  secrets: Record<string, string>;
};

export type StorageProviderDefinition = {
  /** Stable provider id stored on mounts (`s3`, `google-drive`, …). */
  id: string;
  label: string;
  /** Phosphor icon name hint for the UI. */
  icon?: string;
  /** Admins may add org mounts of this provider from Settings › Files. */
  orgAddable: boolean;
  /** Users may connect personal mounts of this provider (ticket 113). */
  personal?: boolean;
  /**
   * Config fields that identify where bytes live (bucket, endpoint, …).
   * Changing them is blocked while the mount holds files.
   */
  locationFields?: string[];
  /** Config fields stored in the vault, never in the mount record. */
  secretFields?: string[];
  create: (
    mount: FilesMount,
    ctx: StorageProviderContext,
  ) => StorageAdapter | Promise<StorageAdapter>;
};

export type StorageProviderRegistry = {
  register: (definition: StorageProviderDefinition) => void;
  get: (id: string) => StorageProviderDefinition | undefined;
  list: () => StorageProviderDefinition[];
};

export function createStorageProviderRegistry(
  definitions: StorageProviderDefinition[] = [],
): StorageProviderRegistry {
  const byId = new Map<string, StorageProviderDefinition>();
  const registry: StorageProviderRegistry = {
    register(definition) {
      byId.set(definition.id, definition);
    },
    get(id) {
      return byId.get(id);
    },
    list() {
      return [...byId.values()];
    },
  };
  for (const definition of definitions) registry.register(definition);
  return registry;
}

/** Process-wide registry used by `server.ts`; tickets 111–114 register here. */
export const storageProviders = createStorageProviderRegistry();
