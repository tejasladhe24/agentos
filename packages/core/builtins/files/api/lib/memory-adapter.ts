import { BlobStoreError } from './blob-store-error';
import { MAX_OBJECT_BYTES } from './constants';
import { normalizeBlobKey } from './normalize-key';
import type {
  BlobListOptions,
  BlobListResult,
  NativeTrashObject,
  StorageAdapter,
  StorageCapabilities,
  StorageIndexMode,
} from './types';

export type MemoryStorageAdapterOptions = {
  provider?: string;
  label?: string;
  indexMode?: StorageIndexMode;
  capabilities?: Partial<StorageCapabilities>;
};

/**
 * In-memory adapter for tests and local demos. With
 * `capabilities.nativeTrash`, deletes go to a provider-style trash.
 */
export function createMemoryStorageAdapter(
  options: MemoryStorageAdapterOptions = {},
): StorageAdapter & {
  objects: Map<string, { bytes: Uint8Array; updatedAt: string }>;
  listCalls: number;
} {
  const objects = new Map<string, { bytes: Uint8Array; updatedAt: string }>();
  const trashed = new Map<
    string,
    NativeTrashObject & { bytes: number; data: Uint8Array }
  >();
  const capabilities: StorageCapabilities = {
    serverSideCopy: true,
    nativeFolders: false,
    nativeTrash: false,
    versions: false,
    maxFileSize: MAX_OBJECT_BYTES,
    exportFormats: [],
    quota: false,
    ...options.capabilities,
  };
  const provider = options.provider ?? 'memory';

  const adapter = {
    provider,
    backend: provider,
    label: options.label ?? `memory://${provider}`,
    indexMode: options.indexMode ?? 'indexed',
    capabilities,
    objects,
    listCalls: 0,
    async put(key: string, bytes: Uint8Array) {
      objects.set(normalizeBlobKey(key), {
        bytes,
        updatedAt: new Date().toISOString(),
      });
    },
    async get(key: string) {
      return objects.get(normalizeBlobKey(key))?.bytes ?? null;
    },
    async delete(key: string) {
      const k = normalizeBlobKey(key);
      objects.delete(k);
      trashed.delete(k);
    },
    async list(opts: BlobListOptions): Promise<BlobListResult> {
      adapter.listCalls += 1;
      const prefix = opts.prefix.replace(/^\/+/, '');
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort();
      if (opts.delimiter === '/') {
        const prefixes = new Set<string>();
        const out: BlobListResult['objects'] = [];
        for (const key of keys) {
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash >= 0) prefixes.add(`${prefix}${rest.slice(0, slash + 1)}`);
          else {
            const o = objects.get(key)!;
            out.push({
              key,
              bytes: o.bytes.byteLength,
              updatedAt: o.updatedAt,
            });
          }
        }
        return { objects: out, prefixes: [...prefixes], cursor: null };
      }
      return {
        objects: keys.map((key) => {
          const o = objects.get(key)!;
          return { key, bytes: o.bytes.byteLength, updatedAt: o.updatedAt };
        }),
        prefixes: [],
        cursor: null,
      };
    },
    async copy(fromKey: string, toKey: string) {
      const from = objects.get(normalizeBlobKey(fromKey));
      if (!from) throw new BlobStoreError('not found', 404);
      objects.set(normalizeBlobKey(toKey), { ...from });
    },
    ...(capabilities.nativeTrash
      ? {
          async trash(key: string) {
            const k = normalizeBlobKey(key);
            const o = objects.get(k);
            if (!o) throw new BlobStoreError('not found', 404);
            const trashKey = `t_${crypto.randomUUID().slice(0, 8)}`;
            trashed.set(trashKey, {
              key: trashKey,
              bytes: o.bytes.byteLength,
              data: o.bytes,
              originalKey: k,
              trashedAt: new Date().toISOString(),
            });
            objects.delete(k);
            return { trashKey };
          },
          async listTrash() {
            return [...trashed.values()].map(
              ({ data: _data, ...rest }) => rest,
            );
          },
          async restore(trashKey: string) {
            const t = trashed.get(trashKey);
            if (!t?.originalKey) throw new BlobStoreError('not found', 404);
            objects.set(t.originalKey, {
              bytes: t.data,
              updatedAt: new Date().toISOString(),
            });
            trashed.delete(trashKey);
            return { key: t.originalKey };
          },
        }
      : {}),
  };
  return adapter;
}
