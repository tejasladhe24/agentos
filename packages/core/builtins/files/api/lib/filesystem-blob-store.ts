import { mkdir, readdir, rm, rmdir, stat, unlink } from 'node:fs/promises';
import { join, normalize, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { BlobStoreError } from './blob-store-error';
import { MAX_OBJECT_BYTES } from './constants';
import { normalizeBlobKey } from './normalize-key';
import type { BlobListOptions, BlobListResult, StorageAdapter } from './types';

function defaultRoot(): string {
  return join(tmpdir(), 'agentos-files');
}

function errnoCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? (error as { code?: string }).code
    : undefined;
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

async function walkFiles(
  dir: string,
  root: string,
): Promise<Array<{ key: string; bytes: number; updatedAt: string }>> {
  const out: Array<{ key: string; bytes: number; updatedAt: string }> = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, root)));
      continue;
    }
    if (!entry.isFile()) continue;
    const st = await stat(full);
    const rel = relative(root, full).split(sep).join('/');
    out.push({
      key: rel,
      bytes: st.size,
      updatedAt: st.mtime.toISOString(),
    });
  }
  return out;
}

/** True when `dir` has at least one file anywhere beneath it. */
async function directoryHasFiles(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isFile()) return true;
    if (entry.isDirectory() && (await directoryHasFiles(full))) return true;
  }
  return false;
}

/**
 * Remove empty parent directories after a file delete, up to (not including) root.
 * Soft-delete leaves empty folder dirs on disk; delimited list would otherwise
 * keep showing those empty prefixes in My Files.
 */
async function pruneEmptyParents(
  rootDir: string,
  deletedFilePath: string,
): Promise<void> {
  const root = resolve(rootDir);
  let dir = resolve(join(deletedFilePath, '..'));
  while (dir !== root && dir.startsWith(root + sep)) {
    try {
      const entries = await readdir(dir);
      if (entries.length > 0) break;
      await rmdir(dir);
    } catch (error) {
      const code = errnoCode(error);
      if (code === 'ENOENT') break;
      // Not empty / busy — stop pruning.
      break;
    }
    dir = resolve(join(dir, '..'));
  }
}

export async function createFilesystemBlobStore(
  rootDir: string = defaultRoot(),
): Promise<StorageAdapter> {
  const root = resolve(rootDir);
  await mkdir(root, { recursive: true });

  return {
    provider: 'filesystem',
    backend: 'filesystem',
    label: root,
    indexMode: 'indexed',
    capabilities: {
      serverSideCopy: true,
      nativeFolders: true,
      nativeTrash: false,
      versions: false,
      maxFileSize: MAX_OBJECT_BYTES,
      exportFormats: [],
      quota: false,
    },
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
        if (errnoCode(error) === 'ENOENT') return;
        throw error;
      }
      await pruneEmptyParents(root, path);
    },
    async list(options: BlobListOptions): Promise<BlobListResult> {
      const prefix = options.prefix.replace(/^\/+/, '');
      const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
      const delimiter = options.delimiter ?? '';

      if (delimiter === '/') {
        const dirKey = prefix.replace(/\/+$/, '');
        const dirPath = dirKey ? resolveBlobPath(root, dirKey) : root;
        const objects: BlobListResult['objects'] = [];
        const prefixes: string[] = [];
        let entries;
        try {
          entries = await readdir(dirPath, { withFileTypes: true });
        } catch (error) {
          if (errnoCode(error) === 'ENOENT') {
            return { objects: [], prefixes: [], cursor: null };
          }
          throw error;
        }

        const names = entries.map((e) => e.name).sort();
        const startAfter = options.cursor ?? '';
        let skipped = startAfter === '' ? true : false;
        for (const name of names) {
          if (!skipped) {
            if (name === startAfter) skipped = true;
            continue;
          }
          const full = join(dirPath, name);
          const rel = relative(root, full).split(sep).join('/');
          const entry = entries.find((e) => e.name === name)!;
          if (entry.isDirectory()) {
            // Skip empty dirs left behind after soft-delete / purge.
            if (!(await directoryHasFiles(full))) {
              try {
                await rm(full, { recursive: true, force: true });
              } catch {
                // ignore
              }
              continue;
            }
            prefixes.push(`${rel}/`);
          } else if (entry.isFile()) {
            const st = await stat(full);
            objects.push({
              key: rel,
              bytes: st.size,
              updatedAt: st.mtime.toISOString(),
            });
          }
          if (objects.length + prefixes.length >= limit) {
            return {
              objects,
              prefixes,
              cursor: name,
            };
          }
        }
        return { objects, prefixes, cursor: null };
      }

      // Recursive flat list under prefix.
      const walkRoot =
        prefix === ''
          ? root
          : resolveBlobPath(root, prefix.replace(/\/+$/, '') || '.');
      let all = await walkFiles(walkRoot, root);
      if (prefix) {
        all = all.filter((o) => o.key.startsWith(prefix));
      }
      all.sort((a, b) => a.key.localeCompare(b.key));
      const startAfter = options.cursor ?? '';
      const sliced =
        startAfter === ''
          ? all
          : all.slice(all.findIndex((o) => o.key === startAfter) + 1);
      const page = sliced.slice(0, limit);
      const next =
        sliced.length > limit ? (page[page.length - 1]?.key ?? null) : null;
      return { objects: page, prefixes: [], cursor: next };
    },
    async copy(fromKey, toKey) {
      const fromPath = resolveBlobPath(root, fromKey);
      const toPath = resolveBlobPath(root, toKey);
      const file = Bun.file(fromPath);
      if (!(await file.exists())) {
        throw new BlobStoreError('not found', 404);
      }
      if (fromPath === toPath) return;
      await mkdir(join(toPath, '..'), { recursive: true });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await Bun.write(toPath, bytes);
    },
  };
}
