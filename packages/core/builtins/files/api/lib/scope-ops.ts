import { parseFileRef, PLATFORM_MOUNT_ID } from '@agentos/core/api/files-ref';

import { BlobStoreError } from './blob-store-error';
import { LIVE_LIST_CACHE_MS, MAX_OBJECT_BYTES } from './constants';
import { liveCache, type FilesContext } from './context';
import type { MountScope } from './mount-scope';
import type { ObjectMetaRecord } from './object-index';
import { keyBasename, relativeOrgKey } from './org-key';
import { computePurgeAt, type BinRetentionDays } from './trash';
import type {
  BlobListObject,
  BlobListOptions,
  BlobListResult,
  StorageReadResult,
} from './types';

export type ListedItem = {
  key: string;
  name: string;
  kind: 'file' | 'folder';
  bytes?: number;
  contentType?: string;
  updatedAt?: string;
  relativeKey: string;
  mountId: string;
  ref: string;
  trashedAt?: string;
  purgeAt?: string | null;
  originalKey?: string;
  webUrl?: string;
  exportFormats?: string[];
};

function nativeTrash(scope: MountScope): boolean {
  return Boolean(
    scope.adapter.capabilities.nativeTrash &&
    scope.adapter.trash &&
    scope.adapter.listTrash &&
    scope.adapter.restore,
  );
}

/** Native trash items live under the virtual `__trash__/` namespace. */
function nativeTrashKey(scope: MountScope, virtualKey: string): string {
  return virtualKey.slice(scope.trashRoot.length);
}

export function maxUploadBytes(scope: MountScope): number {
  return Math.min(MAX_OBJECT_BYTES, scope.adapter.capabilities.maxFileSize);
}

/** Mount-relative path for an index record key (legacy key or ref). */
export function relativeFromIndexKey(orgId: string, key: string): string {
  const ref = parseFileRef(key);
  if (ref) return ref.path;
  return relativeOrgKey(orgId, key);
}

export function mountIdOfRecord(record: ObjectMetaRecord): string {
  return (
    record.mountId ?? parseFileRef(record.key)?.mountId ?? PLATFORM_MOUNT_ID
  );
}

function usesIndex(ctx: FilesContext, scope: MountScope): boolean {
  return Boolean(ctx.index) && scope.adapter.indexMode === 'indexed';
}

export async function indexGet(
  ctx: FilesContext,
  scope: MountScope,
  absKey: string,
): Promise<ObjectMetaRecord | undefined> {
  if (!usesIndex(ctx, scope)) return undefined;
  try {
    const record = await ctx.index!.get(scope.orgId, scope.indexKey(absKey));
    if (record && !record.mountId) {
      const backfilled = { ...record, mountId: scope.mount.id };
      await ctx.index!.put(scope.orgId, backfilled).catch(() => undefined);
      return backfilled;
    }
    return record;
  } catch {
    return undefined;
  }
}

export async function indexPut(
  ctx: FilesContext,
  scope: MountScope,
  record: ObjectMetaRecord,
): Promise<void> {
  if (!usesIndex(ctx, scope)) return;
  try {
    await ctx.index!.put(scope.orgId, {
      ...record,
      key: scope.indexKey(record.key),
      mountId: scope.mount.id,
    });
  } catch {
    // Index is best-effort; blob write already succeeded.
  }
}

export async function indexPutLive(
  ctx: FilesContext,
  scope: MountScope,
  key: string,
  bytes: number,
  contentType: string,
): Promise<void> {
  await indexPut(ctx, scope, {
    key,
    name: keyBasename(key),
    bytes,
    contentType,
    updatedAt: new Date().toISOString(),
  });
}

export async function indexDelete(
  ctx: FilesContext,
  scope: MountScope,
  key: string,
): Promise<void> {
  if (!usesIndex(ctx, scope)) return;
  try {
    await ctx.index!.delete(scope.orgId, scope.indexKey(key));
  } catch {
    // ignore
  }
}

export function invalidateLive(ctx: FilesContext, scope: MountScope): void {
  if (scope.adapter.indexMode !== 'live') return;
  const prefix = `${scope.orgId}:${scope.mount.id}:`;
  const cache = liveCache(ctx);
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export async function listScope(
  ctx: FilesContext,
  scope: MountScope,
  options: BlobListOptions,
): Promise<BlobListResult> {
  if (scope.adapter.indexMode !== 'live') {
    return scope.adapter.list(options);
  }
  const cache = liveCache(ctx);
  const key = `${scope.orgId}:${scope.mount.id}:${options.prefix}:${options.delimiter ?? ''}:${options.cursor ?? ''}:${options.limit ?? ''}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.result;
  const result = await scope.adapter.list(options);
  cache.set(key, { expires: Date.now() + LIVE_LIST_CACHE_MS, result });
  return result;
}

export async function listAllObjects(
  ctx: FilesContext,
  scope: MountScope,
  prefix: string,
): Promise<Array<{ key: string; bytes?: number; updatedAt?: string }>> {
  const listed = await listScope(ctx, scope, {
    prefix,
    limit: 1000,
    delimiter: '',
  });
  const all = [...listed.objects];
  let cursor = listed.cursor;
  while (cursor) {
    const page = await listScope(ctx, scope, {
      prefix,
      limit: 1000,
      cursor,
      delimiter: '',
    });
    all.push(...page.objects);
    cursor = page.cursor;
  }
  return all;
}

export function folderItem(scope: MountScope, prefix: string): ListedItem {
  return {
    key: prefix,
    name: keyBasename(prefix),
    kind: 'folder',
    relativeKey: scope.relative(prefix),
    mountId: scope.mount.id,
    ref: scope.ref(prefix),
  };
}

export async function enrichFile(
  ctx: FilesContext,
  scope: MountScope,
  key: string,
  bytes?: number,
  updatedAt?: string,
  live?: Pick<BlobListObject, 'contentType' | 'webUrl' | 'exportFormats'>,
): Promise<ListedItem> {
  const meta = await indexGet(ctx, scope, key);
  const item: ListedItem = {
    key,
    name: keyBasename(key),
    kind: 'file',
    bytes: meta?.bytes ?? bytes,
    contentType: meta?.contentType ?? live?.contentType,
    updatedAt: meta?.updatedAt ?? updatedAt,
    relativeKey: scope.relative(key),
    mountId: scope.mount.id,
    ref: scope.ref(key),
  };
  if (meta?.trashedAt) item.trashedAt = meta.trashedAt;
  if (meta && meta.purgeAt !== undefined) item.purgeAt = meta.purgeAt;
  if (meta?.originalKey) item.originalKey = scope.relative(meta.originalKey);
  if (live?.webUrl) item.webUrl = live.webUrl;
  if (live?.exportFormats?.length) item.exportFormats = live.exportFormats;
  return item;
}

export type ReadObjectResult = StorageReadResult & {
  /** Download / copy name — exports carry their format extension. */
  name: string;
};

export function withExtension(key: string, extension?: string): string {
  if (!extension) return key;
  const suffix = `.${extension}`;
  return key.toLowerCase().endsWith(suffix) ? key : `${key}${suffix}`;
}

/** Object bytes with the best known MIME type (provider, else index). */
export async function readObject(
  ctx: FilesContext,
  scope: MountScope,
  absKey: string,
  format?: string,
): Promise<ReadObjectResult | null> {
  const name = keyBasename(absKey);
  if (scope.adapter.read) {
    const read = await scope.adapter.read(absKey, format ? { format } : {});
    if (!read) return null;
    return { ...read, name: withExtension(name, read.extension) };
  }
  const bytes = await scope.adapter.get(absKey);
  if (!bytes) return null;
  const meta = await indexGet(ctx, scope, absKey);
  return {
    bytes,
    contentType: meta?.contentType || 'application/octet-stream',
    name,
  };
}

/** Usage across live (non-trash) objects in a mount. */
export async function mountUsage(
  ctx: FilesContext,
  scope: MountScope,
): Promise<{ files: number; bytes: number }> {
  const all = await listAllObjects(ctx, scope, scope.root);
  let files = 0;
  let bytes = 0;
  for (const obj of all) {
    if (obj.key.endsWith('/') || scope.isTrash(obj.key)) continue;
    files += 1;
    bytes += obj.bytes ?? 0;
  }
  return { files, bytes };
}

/** All stored objects in a mount, including bin items. */
export async function countMountObjects(
  ctx: FilesContext,
  scope: MountScope,
): Promise<number> {
  const all = await listAllObjects(ctx, scope, scope.root);
  return all.filter((o) => !o.key.endsWith('/')).length;
}

export async function softDeleteObject(
  ctx: FilesContext,
  scope: MountScope,
  liveAbsKey: string,
  retention: BinRetentionDays,
): Promise<{ trashKey: string; purgeAt: string | null }> {
  const store = scope.adapter;
  if (scope.isTrash(liveAbsKey)) {
    await permanentDelete(ctx, scope, liveAbsKey);
    return { trashKey: liveAbsKey, purgeAt: null };
  }

  if (nativeTrash(scope)) {
    const { trashKey } = await store.trash!(liveAbsKey);
    await indexDelete(ctx, scope, liveAbsKey);
    invalidateLive(ctx, scope);
    return { trashKey: `${scope.trashRoot}${trashKey}`, purgeAt: null };
  }

  const trashKey = scope.toTrash(liveAbsKey);
  const meta = await indexGet(ctx, scope, liveAbsKey);
  const liveBytes =
    meta?.bytes ?? (await store.get(liveAbsKey))?.byteLength ?? 0;

  await store.copy(liveAbsKey, trashKey);
  await store.delete(liveAbsKey);
  await indexDelete(ctx, scope, liveAbsKey);
  invalidateLive(ctx, scope);

  const now = new Date();
  const purgeAt = computePurgeAt(retention, now);
  await indexPut(ctx, scope, {
    key: trashKey,
    name: meta?.name ?? keyBasename(liveAbsKey),
    bytes: liveBytes,
    contentType: meta?.contentType ?? 'application/octet-stream',
    updatedAt: meta?.updatedAt ?? now.toISOString(),
    trashedAt: now.toISOString(),
    purgeAt,
    originalKey: liveAbsKey,
  });
  return { trashKey, purgeAt };
}

export async function permanentDelete(
  ctx: FilesContext,
  scope: MountScope,
  trashAbsKey: string,
): Promise<void> {
  const key = nativeTrash(scope)
    ? nativeTrashKey(scope, trashAbsKey)
    : trashAbsKey;
  await scope.adapter.delete(key);
  await indexDelete(ctx, scope, trashAbsKey);
  invalidateLive(ctx, scope);
}

export async function restoreObject(
  ctx: FilesContext,
  scope: MountScope,
  trashAbsKey: string,
): Promise<{ liveKey: string }> {
  const store = scope.adapter;
  if (nativeTrash(scope)) {
    const { key } = await store.restore!(nativeTrashKey(scope, trashAbsKey));
    invalidateLive(ctx, scope);
    return { liveKey: key };
  }

  const liveKey = scope.fromTrash(trashAbsKey);
  const meta = await indexGet(ctx, scope, trashAbsKey);

  const existing = await store.get(liveKey);
  if (existing) {
    throw new BlobStoreError('restore target already exists', 409);
  }

  await store.copy(trashAbsKey, liveKey);
  await store.delete(trashAbsKey);
  await indexDelete(ctx, scope, trashAbsKey);
  await indexPut(ctx, scope, {
    key: liveKey,
    name: meta?.name ?? keyBasename(liveKey),
    bytes: meta?.bytes ?? (await store.get(liveKey))?.byteLength ?? 0,
    contentType: meta?.contentType ?? 'application/octet-stream',
    updatedAt: new Date().toISOString(),
  });
  invalidateLive(ctx, scope);
  return { liveKey };
}

export async function purgeExpiredTrash(
  ctx: FilesContext,
  scope: MountScope,
): Promise<number> {
  if (nativeTrash(scope) || !usesIndex(ctx, scope)) return 0;
  const now = Date.now();
  let purged = 0;
  try {
    const records = await ctx.index!.listByPrefix(
      scope.orgId,
      scope.indexKey(scope.trashRoot),
      2000,
    );
    for (const record of records) {
      if (record.purgeAt == null) continue;
      if (new Date(record.purgeAt).getTime() > now) continue;
      const absKey = scope.resolveKey(
        relativeFromIndexKey(scope.orgId, record.key),
      );
      try {
        await scope.adapter.delete(absKey);
      } catch {
        // continue
      }
      await indexDelete(ctx, scope, absKey);
      purged += 1;
    }
  } catch {
    // Index unavailable — nothing to purge by policy.
  }
  return purged;
}

export async function listTrashItems(
  ctx: FilesContext,
  scope: MountScope,
): Promise<ListedItem[]> {
  if (nativeTrash(scope)) {
    const objects = await scope.adapter.listTrash!();
    return objects.map((obj) => {
      const virtual = `${scope.trashRoot}${obj.key}`;
      const item: ListedItem = {
        key: virtual,
        name: keyBasename(obj.originalKey ?? obj.key),
        kind: 'file',
        bytes: obj.bytes,
        updatedAt: obj.updatedAt,
        relativeKey: scope.relative(virtual),
        mountId: scope.mount.id,
        ref: scope.ref(virtual),
        purgeAt: null,
      };
      if (obj.trashedAt) item.trashedAt = obj.trashedAt;
      if (obj.originalKey) item.originalKey = scope.relative(obj.originalKey);
      return item;
    });
  }
  await purgeExpiredTrash(ctx, scope);
  const all = await listAllObjects(ctx, scope, scope.trashRoot);
  const items: ListedItem[] = [];
  for (const obj of all) {
    if (obj.key.endsWith('/')) continue;
    items.push(await enrichFile(ctx, scope, obj.key, obj.bytes, obj.updatedAt));
  }
  return items;
}

/**
 * Copy (or move) one object between scopes. Same mount → adapter copy
 * (server-side when supported); across mounts → stream download + upload,
 * bounded by the destination's max file size.
 */
export async function transferObject(
  ctx: FilesContext,
  from: MountScope,
  fromKey: string,
  to: MountScope,
  toKey: string,
  options: { move: boolean },
): Promise<string> {
  if (to.isTrash(toKey)) {
    throw new BlobStoreError(
      'cannot write directly into bin; restore instead',
      400,
    );
  }
  const meta = await indexGet(ctx, from, fromKey);
  let bytes = meta?.bytes;
  let contentType = meta?.contentType;
  let moved = false;

  if (from.mount.id === to.mount.id) {
    if (fromKey === toKey) return toKey;
    if (options.move && from.adapter.move) {
      await from.adapter.move(fromKey, toKey);
      moved = true;
    } else {
      await from.adapter.copy(fromKey, toKey);
    }
  } else {
    const read = await readObject(ctx, from, fromKey);
    if (!read) throw new BlobStoreError('not found', 404);
    const limit = maxUploadBytes(to);
    if (read.bytes.byteLength > limit) {
      throw new BlobStoreError(
        `object exceeds destination max size of ${limit} bytes`,
        413,
      );
    }
    toKey = withExtension(toKey, read.extension);
    contentType = read.contentType;
    await to.adapter.put(toKey, read.bytes, { contentType });
    bytes = read.bytes.byteLength;
  }

  if (options.move) {
    if (!moved) await from.adapter.delete(fromKey);
    await indexDelete(ctx, from, fromKey);
    invalidateLive(ctx, from);
  }
  if (usesIndex(ctx, to)) {
    await indexPutLive(
      ctx,
      to,
      toKey,
      bytes ?? (await to.adapter.get(toKey))?.byteLength ?? 0,
      contentType ?? 'application/octet-stream',
    );
  }
  invalidateLive(ctx, to);
  return toKey;
}
