import { BlobStoreError, type BlobStore } from './blob-store';
import {
  checkFilesPermission,
  type PermissionResult,
} from './check-permission';
import {
  LIST_PAGE_SIZE,
  MAX_OBJECT_BYTES,
  PERMISSION_FILES_READ,
  PERMISSION_FILES_WRITE,
} from './constants';
import type { FilesObjectIndex, ObjectMetaRecord } from './object-index';
import {
  DEFAULT_ORG_SETTINGS,
  type FilesOrgSettingsStore,
} from './org-settings';
import {
  keyBasename,
  relativeOrgKey,
  resolveOrgKey,
  resolveOrgPrefix,
} from './org-key';
import {
  resolveOrgForFilesRequest,
  type ResolveOrgResult,
} from './resolve-org';
import {
  computePurgeAt,
  fromTrashKey,
  isTrashKey,
  parseRetentionDays,
  toTrashKey,
  trashRootPrefix,
  TRASH_SEGMENT,
  type BinRetentionDays,
} from './trash';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function parseBlobPath(path: string): string | null {
  const match = path.match(/^\/blobs\/(.+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export type FilesContext = {
  store: BlobStore;
  runtimeEnv?: Record<string, string | undefined>;
  /** Optional metadata index (db-store). */
  index?: FilesObjectIndex;
  /** Org Files settings (bin retention). */
  settings?: FilesOrgSettingsStore;
  resolveOrg?: (
    request: Request,
    env?: Record<string, string | undefined>,
  ) => Promise<ResolveOrgResult>;
  checkPermission?: (
    request: Request,
    permission: string,
    env?: Record<string, string | undefined>,
  ) => Promise<PermissionResult>;
};

async function ensurePermission(
  ctx: FilesContext,
  request: Request,
  org: Extract<ResolveOrgResult, { ok: true }>,
  permission: string,
): Promise<Response | null> {
  if (org.via === 'header') return null;
  const check = ctx.checkPermission ?? checkFilesPermission;
  const result = await check(request, permission, ctx.runtimeEnv ?? Bun.env);
  if (result === 'unauthenticated') {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (result === 'denied') {
    return json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

async function resolveOrgOrError(
  ctx: FilesContext,
  request: Request,
): Promise<Extract<ResolveOrgResult, { ok: true }> | Response> {
  const resolve = ctx.resolveOrg ?? resolveOrgForFilesRequest;
  const org = await resolve(request, ctx.runtimeEnv ?? Bun.env);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  return org;
}

async function retentionFor(
  ctx: FilesContext,
  orgId: string,
): Promise<BinRetentionDays> {
  if (!ctx.settings) return DEFAULT_ORG_SETTINGS.binRetentionDays;
  try {
    const s = await ctx.settings.get(orgId);
    return s.binRetentionDays;
  } catch {
    return DEFAULT_ORG_SETTINGS.binRetentionDays;
  }
}

async function indexPut(
  ctx: FilesContext,
  orgId: string,
  record: ObjectMetaRecord,
): Promise<void> {
  if (!ctx.index) return;
  try {
    await ctx.index.put(orgId, record);
  } catch {
    // Index is best-effort; blob write already succeeded.
  }
}

async function indexPutLive(
  ctx: FilesContext,
  orgId: string,
  key: string,
  bytes: number,
  contentType: string,
): Promise<void> {
  await indexPut(ctx, orgId, {
    key,
    name: keyBasename(key),
    bytes,
    contentType,
    updatedAt: new Date().toISOString(),
  });
}

async function indexDelete(
  ctx: FilesContext,
  orgId: string,
  key: string,
): Promise<void> {
  if (!ctx.index) return;
  try {
    await ctx.index.delete(orgId, key);
  } catch {
    // ignore
  }
}

type ListedItem = {
  key: string;
  name: string;
  kind: 'file' | 'folder';
  bytes?: number;
  contentType?: string;
  updatedAt?: string;
  relativeKey: string;
  trashedAt?: string;
  purgeAt?: string | null;
  originalKey?: string;
};

async function enrichFile(
  ctx: FilesContext,
  orgId: string,
  key: string,
  bytes?: number,
  updatedAt?: string,
): Promise<ListedItem> {
  let contentType: string | undefined;
  let metaBytes = bytes;
  let metaUpdated = updatedAt;
  let trashedAt: string | undefined;
  let purgeAt: string | null | undefined;
  let originalKey: string | undefined;
  if (ctx.index) {
    try {
      const meta = await ctx.index.get(orgId, key);
      if (meta) {
        contentType = meta.contentType;
        metaBytes = meta.bytes ?? metaBytes;
        metaUpdated = meta.updatedAt ?? metaUpdated;
        trashedAt = meta.trashedAt;
        purgeAt = meta.purgeAt;
        originalKey = meta.originalKey;
      }
    } catch {
      // ignore
    }
  }
  const item: ListedItem = {
    key,
    name: keyBasename(key),
    kind: 'file',
    bytes: metaBytes,
    contentType,
    updatedAt: metaUpdated,
    relativeKey: relativeOrgKey(orgId, key),
  };
  if (trashedAt) item.trashedAt = trashedAt;
  if (purgeAt !== undefined) item.purgeAt = purgeAt;
  if (originalKey) item.originalKey = relativeOrgKey(orgId, originalKey);
  return item;
}

async function listAllObjects(
  store: BlobStore,
  prefix: string,
): Promise<Array<{ key: string; bytes?: number; updatedAt?: string }>> {
  const listed = await store.list({
    prefix,
    limit: 1000,
    delimiter: '',
  });
  const all = [...listed.objects];
  let cursor = listed.cursor;
  while (cursor) {
    const page = await store.list({
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

async function softDeleteObject(
  ctx: FilesContext,
  orgId: string,
  liveAbsKey: string,
  retention: BinRetentionDays,
): Promise<{ trashKey: string; purgeAt: string | null }> {
  const trashKey = toTrashKey(orgId, liveAbsKey);
  if (isTrashKey(orgId, liveAbsKey)) {
    // Already in trash — permanent delete.
    await ctx.store.delete(liveAbsKey);
    await indexDelete(ctx, orgId, liveAbsKey);
    return { trashKey: liveAbsKey, purgeAt: null };
  }

  const meta = ctx.index
    ? await ctx.index.get(orgId, liveAbsKey).catch(() => undefined)
    : undefined;
  const liveBytes =
    meta?.bytes ?? (await ctx.store.get(liveAbsKey))?.byteLength ?? 0;

  await ctx.store.copy(liveAbsKey, trashKey);
  await ctx.store.delete(liveAbsKey);
  await indexDelete(ctx, orgId, liveAbsKey);

  const now = new Date();
  const purgeAt = computePurgeAt(retention, now);
  await indexPut(ctx, orgId, {
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

async function restoreObject(
  ctx: FilesContext,
  orgId: string,
  trashAbsKey: string,
): Promise<{ liveKey: string }> {
  const liveKey = fromTrashKey(orgId, trashAbsKey);
  const meta = ctx.index
    ? await ctx.index.get(orgId, trashAbsKey).catch(() => undefined)
    : undefined;

  const existing = await ctx.store.get(liveKey);
  if (existing) {
    throw new BlobStoreError('restore target already exists', 409);
  }

  await ctx.store.copy(trashAbsKey, liveKey);
  await ctx.store.delete(trashAbsKey);
  await indexDelete(ctx, orgId, trashAbsKey);
  await indexPut(ctx, orgId, {
    key: liveKey,
    name: meta?.name ?? keyBasename(liveKey),
    bytes: meta?.bytes ?? (await ctx.store.get(liveKey))?.byteLength ?? 0,
    contentType: meta?.contentType ?? 'application/octet-stream',
    updatedAt: new Date().toISOString(),
  });
  return { liveKey };
}

async function purgeExpiredTrash(
  ctx: FilesContext,
  orgId: string,
): Promise<number> {
  const trashPrefix = trashRootPrefix(orgId);
  const now = Date.now();
  let purged = 0;

  if (ctx.index) {
    try {
      const records = await ctx.index.listByPrefix(orgId, trashPrefix, 2000);
      for (const record of records) {
        if (record.purgeAt == null) continue;
        if (new Date(record.purgeAt).getTime() > now) continue;
        try {
          await ctx.store.delete(record.key);
        } catch {
          // continue
        }
        await indexDelete(ctx, orgId, record.key);
        purged += 1;
      }
      return purged;
    } catch {
      // fall through to store scan
    }
  }

  const objects = await listAllObjects(ctx.store, trashPrefix);
  for (const obj of objects) {
    if (ctx.index) {
      const meta = await ctx.index.get(orgId, obj.key).catch(() => undefined);
      if (!meta?.purgeAt) continue;
      if (new Date(meta.purgeAt).getTime() > now) continue;
    } else {
      continue;
    }
    await ctx.store.delete(obj.key);
    await indexDelete(ctx, orgId, obj.key);
    purged += 1;
  }
  return purged;
}

/**
 * Bun request router for `/api/ext/files/*` upstream paths.
 */
export async function handleFilesRequest(
  ctx: FilesContext,
  request: Request,
): Promise<Response> {
  const store = ctx.store;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({
      ok: true,
      backend: store.backend,
      label: store.label,
      index: Boolean(ctx.index),
    });
  }

  // GET /org-settings — bin retention
  if (method === 'GET' && path === '/org-settings') {
    const org = await resolveOrgOrError(ctx, request);
    if (org instanceof Response) return org;
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_READ,
    );
    if (denied) return denied;
    const settings = ctx.settings
      ? await ctx.settings.get(org.orgId)
      : { ...DEFAULT_ORG_SETTINGS };
    return json(settings);
  }

  // PUT /org-settings
  if (method === 'PUT' && path === '/org-settings') {
    const org = await resolveOrgOrError(ctx, request);
    if (org instanceof Response) return org;
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_WRITE,
    );
    if (denied) return denied;
    if (!ctx.settings) {
      return json({ error: 'settings unavailable' }, { status: 503 });
    }
    let body: { binRetentionDays?: unknown };
    try {
      body = (await request.json()) as { binRetentionDays?: unknown };
    } catch {
      return json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (!('binRetentionDays' in body)) {
      return json({ error: 'binRetentionDays required' }, { status: 400 });
    }
    const binRetentionDays = parseRetentionDays(body.binRetentionDays);
    // Reject unknown numeric values that aren't 15/30/null
    if (
      body.binRetentionDays !== null &&
      body.binRetentionDays !== 'null' &&
      body.binRetentionDays !== 'never' &&
      body.binRetentionDays !== 0 &&
      body.binRetentionDays !== 15 &&
      body.binRetentionDays !== 30 &&
      body.binRetentionDays !== '15' &&
      body.binRetentionDays !== '30'
    ) {
      return json(
        { error: 'binRetentionDays must be 15, 30, or null (do not delete)' },
        { status: 400 },
      );
    }
    const saved = await ctx.settings.put(org.orgId, { binRetentionDays });
    return json(saved);
  }

  // POST /blobs/restore
  if (method === 'POST' && path === '/blobs/restore') {
    const org = await resolveOrgOrError(ctx, request);
    if (org instanceof Response) return org;
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_WRITE,
    );
    if (denied) return denied;

    let body: { key?: string };
    try {
      body = (await request.json()) as { key?: string };
    } catch {
      return json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (!body.key) {
      return json({ error: 'key required' }, { status: 400 });
    }

    try {
      let trashAbs = resolveOrgKey(org.orgId, body.key);
      if (!isTrashKey(org.orgId, trashAbs)) {
        // Allow restore by original live relative key → map into trash.
        trashAbs = toTrashKey(org.orgId, trashAbs);
      }
      const result = await restoreObject(ctx, org.orgId, trashAbs);
      return json({
        ok: true,
        key: result.liveKey,
        relativeKey: relativeOrgKey(org.orgId, result.liveKey),
      });
    } catch (error) {
      if (error instanceof BlobStoreError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  // GET /blobs — list, search, bin, or storage
  if (method === 'GET' && path === '/blobs') {
    const org = await resolveOrgOrError(ctx, request);
    if (org instanceof Response) return org;
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_READ,
    );
    if (denied) return denied;

    const view = url.searchParams.get('view') ?? 'files';
    const q = url.searchParams.get('q')?.trim() ?? '';
    const limit = Math.min(
      Number(url.searchParams.get('limit') || LIST_PAGE_SIZE) || LIST_PAGE_SIZE,
      1000,
    );
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const rawPrefix = url.searchParams.get('prefix') ?? '';

    try {
      if (view === 'bin') {
        await purgeExpiredTrash(ctx, org.orgId);
        const trashPrefix = trashRootPrefix(org.orgId);
        const all = await listAllObjects(store, trashPrefix);
        const items: ListedItem[] = [];
        for (const obj of all) {
          if (obj.key.endsWith('/')) continue;
          items.push(
            await enrichFile(
              ctx,
              org.orgId,
              obj.key,
              obj.bytes,
              obj.updatedAt,
            ),
          );
        }
        items.sort((a, b) =>
          (b.trashedAt ?? b.updatedAt ?? '').localeCompare(
            a.trashedAt ?? a.updatedAt ?? '',
          ),
        );
        return json({
          items: items.slice(0, limit),
          cursor: null,
          prefix: `${TRASH_SEGMENT}/`,
          view: 'bin',
        });
      }

      if (view === 'storage') {
        const orgPrefix = resolveOrgPrefix(org.orgId, '');
        const all = await listAllObjects(store, orgPrefix);
        const trashPrefix = trashRootPrefix(org.orgId);
        const files: ListedItem[] = [];
        for (const obj of all) {
          if (obj.key.endsWith('/')) continue;
          if (obj.key.startsWith(trashPrefix)) continue;
          files.push(
            await enrichFile(
              ctx,
              org.orgId,
              obj.key,
              obj.bytes,
              obj.updatedAt,
            ),
          );
        }
        files.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
        return json({
          items: files.slice(0, limit),
          cursor: null,
          prefix: '',
          view: 'storage',
        });
      }

      if (q && ctx.index) {
        const hits = await ctx.index.searchByName(org.orgId, q, limit);
        const trashPrefix = trashRootPrefix(org.orgId);
        const items: ListedItem[] = hits
          .filter((h) => !h.key.startsWith(trashPrefix) && !h.trashedAt)
          .map((h) => ({
            key: h.key,
            name: h.name,
            kind: 'file' as const,
            bytes: h.bytes,
            contentType: h.contentType,
            updatedAt: h.updatedAt,
            relativeKey: relativeOrgKey(org.orgId, h.key),
          }));
        return json({ items, cursor: null, prefix: rawPrefix, q });
      }

      const absPrefix = resolveOrgPrefix(org.orgId, rawPrefix);
      // Refuse browsing into trash via My Files prefix
      if (isTrashKey(org.orgId, absPrefix) || absPrefix.includes(`/${TRASH_SEGMENT}/`)) {
        return json({
          items: [],
          cursor: null,
          prefix: rawPrefix,
          view: 'files',
        });
      }

      const listed = await store.list({
        prefix: absPrefix,
        limit,
        cursor,
        delimiter: '/',
      });

      const items: ListedItem[] = [];
      for (const prefix of listed.prefixes) {
        const rel = relativeOrgKey(org.orgId, prefix);
        if (rel === `${TRASH_SEGMENT}/` || rel.startsWith(`${TRASH_SEGMENT}/`)) {
          continue;
        }
        items.push({
          key: prefix,
          name: keyBasename(prefix),
          kind: 'folder',
          relativeKey: rel,
        });
      }
      for (const obj of listed.objects) {
        if (obj.key === absPrefix || obj.key.endsWith('/')) continue;
        if (isTrashKey(org.orgId, obj.key)) continue;
        items.push(
          await enrichFile(ctx, org.orgId, obj.key, obj.bytes, obj.updatedAt),
        );
      }

      if (q) {
        const lower = q.toLowerCase();
        return json({
          items: items.filter((i) => i.name.toLowerCase().includes(lower)),
          cursor: null,
          prefix: rawPrefix,
          q,
        });
      }

      return json({
        items,
        cursor: listed.cursor ?? null,
        prefix: rawPrefix,
        view: 'files',
      });
    } catch (error) {
      if (error instanceof BlobStoreError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  // DELETE /blobs?prefix= — soft-delete folder (or permanent if under trash)
  if (method === 'DELETE' && path === '/blobs') {
    const org = await resolveOrgOrError(ctx, request);
    if (org instanceof Response) return org;
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_WRITE,
    );
    if (denied) return denied;

    const rawPrefix = url.searchParams.get('prefix');
    if (!rawPrefix) {
      return json({ error: 'prefix required' }, { status: 400 });
    }
    try {
      const absPrefix = resolveOrgPrefix(org.orgId, rawPrefix);
      const retention = await retentionFor(ctx, org.orgId);
      const objects = await listAllObjects(store, absPrefix);
      let deleted = 0;
      const permanent = isTrashKey(org.orgId, absPrefix);
      for (const obj of objects) {
        if (permanent) {
          await store.delete(obj.key);
          await indexDelete(ctx, org.orgId, obj.key);
        } else {
          await softDeleteObject(ctx, org.orgId, obj.key, retention);
        }
        deleted += 1;
      }
      return json({
        ok: true,
        deleted,
        prefix: absPrefix,
        trashed: !permanent,
      });
    } catch (error) {
      if (error instanceof BlobStoreError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  // POST /blobs/move
  if (method === 'POST' && path === '/blobs/move') {
    const org = await resolveOrgOrError(ctx, request);
    if (org instanceof Response) return org;
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_WRITE,
    );
    if (denied) return denied;

    let body: { from?: string; to?: string };
    try {
      body = (await request.json()) as { from?: string; to?: string };
    } catch {
      return json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (!body.from || !body.to) {
      return json({ error: 'from and to required' }, { status: 400 });
    }

    try {
      const fromIsFolder = body.from.endsWith('/');
      const toIsFolder = body.to.endsWith('/') || fromIsFolder;

      if (fromIsFolder || toIsFolder) {
        const fromPrefix = resolveOrgPrefix(org.orgId, body.from);
        const toPrefix = resolveOrgPrefix(org.orgId, body.to);
        const all = await listAllObjects(store, fromPrefix);
        const moved: string[] = [];
        for (const obj of all) {
          const suffix = obj.key.slice(fromPrefix.length);
          const dest = `${toPrefix}${suffix}`;
          await store.copy(obj.key, dest);
          await store.delete(obj.key);
          const meta = ctx.index
            ? await ctx.index.get(org.orgId, obj.key).catch(() => undefined)
            : undefined;
          await indexDelete(ctx, org.orgId, obj.key);
          await indexPutLive(
            ctx,
            org.orgId,
            dest,
            meta?.bytes ?? obj.bytes ?? 0,
            meta?.contentType ?? 'application/octet-stream',
          );
          moved.push(dest);
        }
        return json({ ok: true, moved, from: fromPrefix, to: toPrefix });
      }

      const fromKey = resolveOrgKey(org.orgId, body.from);
      const toKey = resolveOrgKey(org.orgId, body.to);
      const meta = ctx.index
        ? await ctx.index.get(org.orgId, fromKey).catch(() => undefined)
        : undefined;
      await store.copy(fromKey, toKey);
      await store.delete(fromKey);
      await indexDelete(ctx, org.orgId, fromKey);
      const bytes = meta?.bytes ?? (await store.get(toKey))?.byteLength ?? 0;
      await indexPutLive(
        ctx,
        org.orgId,
        toKey,
        bytes,
        meta?.contentType ?? 'application/octet-stream',
      );
      return json({ ok: true, from: fromKey, to: toKey });
    } catch (error) {
      if (error instanceof BlobStoreError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  const key = parseBlobPath(path);
  if (!key) {
    return json({ error: 'not found' }, { status: 404 });
  }

  const org = await resolveOrgOrError(ctx, request);
  if (org instanceof Response) return org;

  try {
    const absKey = resolveOrgKey(org.orgId, key);

    if (method === 'PUT') {
      const denied = await ensurePermission(
        ctx,
        request,
        org,
        PERMISSION_FILES_WRITE,
      );
      if (denied) return denied;

      if (isTrashKey(org.orgId, absKey)) {
        return json(
          { error: 'cannot write directly into bin; restore instead' },
          { status: 400 },
        );
      }

      const contentTypeHeader = request.headers.get('content-type') ?? '';
      let bytes: Uint8Array;
      let storedContentType = 'application/octet-stream';

      if (contentTypeHeader.includes('application/json')) {
        const body = (await request.json()) as {
          data?: string;
          base64?: string;
          contentType?: string;
        };
        const b64 =
          typeof body.base64 === 'string'
            ? body.base64
            : typeof body.data === 'string'
              ? body.data
              : null;
        if (!b64) {
          return json(
            { error: 'base64 (or data) required in JSON body' },
            { status: 400 },
          );
        }
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        if (typeof body.contentType === 'string' && body.contentType) {
          storedContentType = body.contentType;
        }
      } else {
        bytes = new Uint8Array(await request.arrayBuffer());
        const explicit = request.headers.get('x-agentos-content-type');
        if (explicit) {
          storedContentType = explicit;
        } else if (
          contentTypeHeader &&
          !contentTypeHeader.includes('application/octet-stream')
        ) {
          storedContentType = contentTypeHeader.split(';')[0]!.trim();
        }
      }

      if (bytes.byteLength > MAX_OBJECT_BYTES) {
        return json(
          {
            error: `object exceeds max size of ${MAX_OBJECT_BYTES} bytes`,
            maxBytes: MAX_OBJECT_BYTES,
          },
          { status: 413 },
        );
      }

      await store.put(absKey, bytes);
      await indexPutLive(
        ctx,
        org.orgId,
        absKey,
        bytes.byteLength,
        storedContentType,
      );
      return json({
        ok: true,
        key: absKey,
        bytes: bytes.byteLength,
        contentType: storedContentType,
      });
    }

    if (method === 'GET') {
      const denied = await ensurePermission(
        ctx,
        request,
        org,
        PERMISSION_FILES_READ,
      );
      if (denied) return denied;

      const bytes = await store.get(absKey);
      if (!bytes) {
        return json({ error: 'not found' }, { status: 404 });
      }
      let contentType = 'application/octet-stream';
      let updatedAt: string | undefined;
      if (ctx.index) {
        try {
          const meta = await ctx.index.get(org.orgId, absKey);
          if (meta?.contentType) contentType = meta.contentType;
          if (meta?.updatedAt) updatedAt = meta.updatedAt;
        } catch {
          // ignore
        }
      }
      const asJson = url.searchParams.get('format') === 'json';
      if (asJson) {
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return json({
          key: absKey,
          base64: btoa(binary),
          bytes: bytes.byteLength,
          contentType,
          updatedAt,
        });
      }
      return new Response(bytes, {
        headers: {
          'content-type': contentType,
          'content-length': String(bytes.byteLength),
        },
      });
    }

    if (method === 'DELETE') {
      const denied = await ensurePermission(
        ctx,
        request,
        org,
        PERMISSION_FILES_WRITE,
      );
      if (denied) return denied;

      const retention = await retentionFor(ctx, org.orgId);
      if (isTrashKey(org.orgId, absKey)) {
        await store.delete(absKey);
        await indexDelete(ctx, org.orgId, absKey);
        return json({ ok: true, key: absKey, purged: true });
      }

      const exists = await store.get(absKey);
      if (!exists) {
        // Idempotent soft-delete of missing key
        return json({ ok: true, key: absKey, trashed: false, missing: true });
      }

      const result = await softDeleteObject(
        ctx,
        org.orgId,
        absKey,
        retention,
      );
      return json({
        ok: true,
        key: absKey,
        trashKey: result.trashKey,
        purgeAt: result.purgeAt,
        trashed: true,
      });
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  } catch (error) {
    if (error instanceof BlobStoreError) {
      return json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
