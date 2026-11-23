import { mkdir, unlink } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { BlobStoreError } from './blob-store-error';
import { normalizeBlobKey } from './normalize-key';
import type { BlobStore } from './types';

function defaultRoot(): string {
  return join(tmpdir(), 'agentos-files');
}

/** Resolve a blob key under root; reject path traversal. */
export function resolveBlobPath(rootDir: string, key: string): string {
  const normalizedKey = normalizeBlobKey(key);
  const root = resolve(rootDir);
  const target = resolve(root, normalize(normalizedKey));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new BlobStoreError('path traversal rejected', 400);
  }
  return target;
}

export async function createFilesystemBlobStore(
  rootDir: string = defaultRoot(),
): Promise<BlobStore> {
  const root = resolve(rootDir);
  await mkdir(root, { recursive: true });

  return {
    backend: 'filesystem',
    label: root,
    async put(key, bytes) {
      const path = resolveBlobPath(root, key);
      await mkdir(join(path, '..'), { recursive: true });
      await Bun.write(path, bytes);
    },
    async get(key) {
      const path = resolveBlobPath(root, key);
      const file = Bun.file(path);
      if (!(await file.exists())) return null;
      return new Uint8Array(await file.arrayBuffer());
    },
    async delete(key) {
      const path = resolveBlobPath(root, key);
      try {
        await unlink(path);
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        if (code === 'ENOENT') return;
        throw error;
      }
    },
  };
}
