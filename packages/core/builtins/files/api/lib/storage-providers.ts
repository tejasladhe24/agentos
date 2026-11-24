import type { FilesMount } from './mount-types';
import type { StorageAdapter } from './types';

export type StorageProviderContext = {
  orgId: string;
  runtimeEnv?: Record<string, string | undefined>;
  /** Decrypted secret config fields from the vault (credentials, tokens). */
  secrets: Record<string, string>;
};

/** Form field the Settings UI renders when adding a mount. */
export type StorageProviderField = {
  id: string;
  label: string;
  /** `secret` values go to the vault and are never echoed back. */
  type: 'text' | 'secret' | 'choice';
  /** Options for `choice` fields; the first is the default. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Required when the provider has no presets (presets list their own). */
  required?: boolean;
  placeholder?: string;
  help?: string;
};

/** Preset of a provider (e.g. Cloudflare R2 on the S3 adapter). */
export type StorageProviderPreset = {
  id: string;
  label: string;
  help?: string;
  /** Non-secret field ids shown for this preset (secrets always shown). */
  fields?: string[];
  required?: string[];
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
  fields?: readonly StorageProviderField[];
  presets?: readonly StorageProviderPreset[];
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
