import { parseFileRef, PLATFORM_MOUNT_ID } from '@agentos/core/api/files-ref';

import {
  LIST_PAGE_SIZE,
  PERMISSION_FILES_READ,
  PERMISSION_FILES_WRITE,
} from './constants';
import {
  ensurePermission,
  mountResolver,
  resolveOrgOrError,
  scopeForMount,
  scopeOrError,
  viewerOf,
  writeDenied,
  type FilesContext,
  type ResolvedOrg,
} from './context';
import { errorResponse, json, readJson } from './http';
import { handleMountsRequest } from './mount-routes';
import { handlePersonalMountsRequest } from './personal-mount-routes';
import type { MountScope } from './mount-scope';
import { DEFAULT_ORG_SETTINGS } from './org-settings';
import {
  enrichFile,
  folderItem,
  indexGet,
  indexPutLive,
  invalidateLive,
  listAllObjects,
  listScope,
  listTrashItems,
  maxUploadBytes,
  mountIdOfRecord,
  permanentDelete,
  readObject,
  relativeFromIndexKey,
  restoreObject,
  softDeleteObject,
  transferObject,
  type ListedItem,
} from './scope-ops';
import {
  parseRetentionDays,
  TRASH_SEGMENT,
  type BinRetentionDays,
} from './trash';

export type { FilesContext, MountReferenceCounter } from './context';

function parseBlobPath(path: string): string | null {
  const match = path.match(/^\/blobs\/(.+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

type Target = { mountId: string; key: string };

/**
 * `files://<mountId>/<path>` → that mount; otherwise `mount` param, else the
 * platform mount (legacy keys always resolve to platform).
 */
function resolveTarget(raw: string, mountParam?: string | null): Target {
  const ref = parseFileRef(raw);
  if (ref) return { mountId: ref.mountId, key: ref.path };
  return { mountId: mountParam || PLATFORM_MOUNT_ID, key: raw };
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

/** Scopes for views spanning mounts (`mount` param narrows to one). */
async function scopesForView(
  ctx: FilesContext,
  org: ResolvedOrg,
  mountParam: string | null,
): Promise<MountScope[] | Response> {
  if (mountParam) {
    const scope = await scopeOrError(ctx, org, mountParam);
    return scope instanceof Response ? scope : [scope];
  }
  const mounts = await mountResolver(ctx).list(org.orgId, viewerOf(org));
  const scopes: MountScope[] = [];
  for (const mount of mounts) {
    try {
      scopes.push(await scopeForMount(ctx, org, mount));
    } catch {
      // Unavailable mount — skip in cross-mount views.
    }
  }
  return scopes;
}

function withMountNames(
  items: ListedItem[],
  scopes: MountScope[],
): Array<ListedItem & { mountName?: string }> {
  const names = new Map(scopes.map((s) => [s.mount.id, s.mount.name]));
  return items.map((item) => ({ ...item, mountName: names.get(item.mountId) }));
}

function isRetentionValue(value: unknown): boolean {
  return (
    value === null ||
    value === 'null' ||
    value === 'never' ||
    value === 0 ||
    value === 15 ||
    value === 30 ||
    value === '15' ||
    value === '30'
  );
}

async function handleTransfer(
  ctx: FilesContext,
  request: Request,
  org: ResolvedOrg,
  move: boolean,
): Promise<Response> {
  const body = await readJson<{
    from?: string;
    to?: string;
    mount?: string;
    fromMount?: string;
    toMount?: string;
  }>(request);
  if (body instanceof Response) return body;
  if (!body.from || !body.to) {
    return json({ error: 'from and to required' }, { status: 400 });
  }

  const fromTarget = resolveTarget(body.from, body.fromMount ?? body.mount);
  const toRef = parseFileRef(body.to);
  const toTarget: Target = toRef
    ? { mountId: toRef.mountId, key: toRef.path }
    : {
        mountId: body.toMount ?? body.mount ?? fromTarget.mountId,
        key: body.to,
      };

  const from = await scopeOrError(ctx, org, fromTarget.mountId);
  if (from instanceof Response) return from;
  const to = await scopeOrError(ctx, org, toTarget.mountId);
  if (to instanceof Response) return to;
  const denied =
    writeDenied(org, to.mount) ?? (move ? writeDenied(org, from.mount) : null);
  if (denied) return denied;

  const fromIsFolder = fromTarget.key.endsWith('/');
  const toIsFolder = toTarget.key.endsWith('/') || fromIsFolder;

  if (fromIsFolder || toIsFolder) {
    const fromPrefix = from.resolvePrefix(fromTarget.key);
    const toPrefix = to.resolvePrefix(toTarget.key);
    const all = await listAllObjects(ctx, from, fromPrefix);
    const keys: string[] = [];
    const refs: string[] = [];
    for (const obj of all) {
      if (obj.key.endsWith('/') || from.isTrash(obj.key)) continue;
      const dest = await transferObject(
        ctx,
        from,
        obj.key,
        to,
        `${toPrefix}${obj.key.slice(fromPrefix.length)}`,
        { move },
      );
      keys.push(dest);
      refs.push(to.ref(dest));
    }
    return json({
      ok: true,
      [move ? 'moved' : 'copied']: keys,
      refs,
      total: keys.length,
      from: fromPrefix,
      to: toPrefix,
      fromRef: from.ref(fromPrefix),
      toRef: to.ref(toPrefix),
    });
  }

  const fromKey = from.resolveKey(fromTarget.key);
  const toKey = await transferObject(
    ctx,
    from,
    fromKey,
    to,
    to.resolveKey(toTarget.key),
    { move },
  );
  return json({
    ok: true,
    from: fromKey,
    to: toKey,
    fromRef: from.ref(fromKey),
    toRef: to.ref(toKey),
  });
}

async function readPutBody(
  request: Request,
): Promise<{ bytes: Uint8Array; contentType: string } | Response> {
  const contentTypeHeader = request.headers.get('content-type') ?? '';
  let storedContentType = 'application/octet-stream';

  if (contentTypeHeader.includes('application/json')) {
    const body = await readJson<{
      data?: string;
      base64?: string;
      contentType?: string;
    }>(request);
    if (body instanceof Response) return body;
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
    if (typeof body.contentType === 'string' && body.contentType) {
      storedContentType = body.contentType;
    }
    return {
      bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      contentType: storedContentType,
    };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const explicit = request.headers.get('x-agentos-content-type');
  if (explicit) {
    storedContentType = explicit;
  } else if (
    contentTypeHeader &&
    !contentTypeHeader.includes('application/octet-stream')
  ) {
    storedContentType = contentTypeHeader.split(';')[0]!.trim();
  }
  return { bytes, contentType: storedContentType };
}

/**
 * Bun request router for `/api/ext/files/*` upstream paths.
 */
export async function handleFilesRequest(
  ctx: FilesContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const mountParam = url.searchParams.get('mount');

  if (method === 'GET' && path === '/health') {
    return json({
      ok: true,
      backend: ctx.store.backend ?? ctx.store.provider,
      provider: ctx.store.provider,
      label: ctx.store.label,
      index: Boolean(ctx.index),
      mounts: Boolean(ctx.mounts),
    });
  }

  const personalResponse = await handlePersonalMountsRequest(
    ctx,
    request,
    path,
    method,
  );
  if (personalResponse) return personalResponse;

  const mountsResponse = await handleMountsRequest(ctx, request, path, method);
  if (mountsResponse) return mountsResponse;

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
    const body = await readJson<{ binRetentionDays?: unknown }>(request);
    if (body instanceof Response) return body;
    if (!('binRetentionDays' in body)) {
      return json({ error: 'binRetentionDays required' }, { status: 400 });
    }
    if (!isRetentionValue(body.binRetentionDays)) {
      return json(
        { error: 'binRetentionDays must be 15, 30, or null (do not delete)' },
        { status: 400 },
      );
    }
    const saved = await ctx.settings.put(org.orgId, {
      binRetentionDays: parseRetentionDays(body.binRetentionDays),
    });
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

    const body = await readJson<{ key?: string; mountId?: string }>(request);
    if (body instanceof Response) return body;
    if (!body.key) {
      return json({ error: 'key required' }, { status: 400 });
    }

    try {
      const target = resolveTarget(body.key, body.mountId ?? mountParam);
      const scope = await scopeOrError(ctx, org, target.mountId);
      if (scope instanceof Response) return scope;
      const writeBlocked = writeDenied(org, scope.mount);
      if (writeBlocked) return writeBlocked;
      let trashAbs = scope.resolveKey(target.key);
      if (!scope.isTrash(trashAbs)) {
        // Allow restore by original live relative key → map into trash.
        trashAbs = scope.toTrash(trashAbs);
      }
      const result = await restoreObject(ctx, scope, trashAbs);
      return json({
        ok: true,
        key: result.liveKey,
        relativeKey: scope.relative(result.liveKey),
        mountId: scope.mount.id,
        ref: scope.ref(result.liveKey),
      });
    } catch (error) {
      return errorResponse(error);
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
      if (view === 'bin' || view === 'storage') {
        const scopes = await scopesForView(ctx, org, mountParam);
        if (scopes instanceof Response) return scopes;
        const items: ListedItem[] = [];
        for (const scope of scopes) {
          if (view === 'bin') {
            items.push(...(await listTrashItems(ctx, scope)));
            continue;
          }
          // Live drives are browsed in place; crawling them is unbounded.
          if (scope.adapter.indexMode === 'live') continue;
          const all = await listAllObjects(ctx, scope, scope.root);
          for (const obj of all) {
            if (obj.key.endsWith('/') || scope.isTrash(obj.key)) continue;
            items.push(
              await enrichFile(ctx, scope, obj.key, obj.bytes, obj.updatedAt),
            );
          }
        }
        if (view === 'bin') {
          items.sort((a, b) =>
            (b.trashedAt ?? b.updatedAt ?? '').localeCompare(
              a.trashedAt ?? a.updatedAt ?? '',
            ),
          );
        } else {
          items.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
        }
        return json({
          items: withMountNames(items.slice(0, limit), scopes),
          cursor: null,
          prefix: view === 'bin' ? `${TRASH_SEGMENT}/` : '',
          view,
        });
      }

      if (q && ctx.index) {
        const scopes = await scopesForView(ctx, org, mountParam);
        if (scopes instanceof Response) return scopes;
        const byId = new Map(scopes.map((s) => [s.mount.id, s]));
        const hits = await ctx.index.searchByName(org.orgId, q, limit);
        const items: ListedItem[] = [];
        for (const hit of hits) {
          const scope = byId.get(mountIdOfRecord(hit));
          if (!scope || hit.trashedAt) continue;
          const relativeKey = relativeFromIndexKey(org.orgId, hit.key);
          if (relativeKey.startsWith(`${TRASH_SEGMENT}/`)) continue;
          const absKey = scope.resolveKey(relativeKey);
          items.push({
            key: absKey,
            name: hit.name,
            kind: 'file',
            bytes: hit.bytes,
            contentType: hit.contentType,
            updatedAt: hit.updatedAt,
            relativeKey,
            mountId: scope.mount.id,
            ref: scope.ref(absKey),
          });
        }
        return json({ items, cursor: null, prefix: rawPrefix, q });
      }

      const scope = await scopeOrError(ctx, org, mountParam ?? undefined);
      if (scope instanceof Response) return scope;
      const absPrefix = scope.resolvePrefix(rawPrefix);
      // Refuse browsing into trash via the Drive prefix
      if (
        scope.isTrash(absPrefix) ||
        absPrefix.includes(`/${TRASH_SEGMENT}/`)
      ) {
        return json({
          items: [],
          cursor: null,
          prefix: rawPrefix,
          view: 'files',
          mountId: scope.mount.id,
        });
      }

      const listed = await listScope(ctx, scope, {
        prefix: absPrefix,
        limit,
        cursor,
        delimiter: '/',
      });

      const items: ListedItem[] = [];
      for (const prefix of listed.prefixes) {
        const rel = scope.relative(prefix);
        if (
          rel === `${TRASH_SEGMENT}/` ||
          rel.startsWith(`${TRASH_SEGMENT}/`)
        ) {
          continue;
        }
        items.push(folderItem(scope, prefix));
      }
      for (const obj of listed.objects) {
        if (obj.key === absPrefix || obj.key.endsWith('/')) continue;
        if (scope.isTrash(obj.key)) continue;
        items.push(
          await enrichFile(ctx, scope, obj.key, obj.bytes, obj.updatedAt, obj),
        );
      }

      if (q) {
        const lower = q.toLowerCase();
        return json({
          items: items.filter((i) => i.name.toLowerCase().includes(lower)),
          cursor: null,
          prefix: rawPrefix,
          q,
          mountId: scope.mount.id,
        });
      }

      return json({
        items,
        cursor: listed.cursor ?? null,
        prefix: rawPrefix,
        view: 'files',
        mountId: scope.mount.id,
      });
    } catch (error) {
      return errorResponse(error);
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
      const target = resolveTarget(rawPrefix, mountParam);
      const scope = await scopeOrError(ctx, org, target.mountId);
      if (scope instanceof Response) return scope;
      const writeBlocked = writeDenied(org, scope.mount);
      if (writeBlocked) return writeBlocked;
      const absPrefix = scope.resolvePrefix(target.key);
      const retention = await retentionFor(ctx, org.orgId);
      const objects = await listAllObjects(ctx, scope, absPrefix);
      let deleted = 0;
      const permanent = scope.isTrash(absPrefix);
      for (const obj of objects) {
        if (permanent) {
          await permanentDelete(ctx, scope, obj.key);
        } else {
          await softDeleteObject(ctx, scope, obj.key, retention);
        }
        deleted += 1;
      }
      return json({
        ok: true,
        deleted,
        prefix: absPrefix,
        mountId: scope.mount.id,
        trashed: !permanent,
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  // POST /blobs/move | /blobs/copy — within or across mounts
  if (method === 'POST' && (path === '/blobs/move' || path === '/blobs/copy')) {
    const org = await resolveOrgOrError(ctx, request);
    if (org instanceof Response) return org;
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_WRITE,
    );
    if (denied) return denied;
    try {
      return await handleTransfer(ctx, request, org, path === '/blobs/move');
    } catch (error) {
      return errorResponse(error);
    }
  }

  const rawKey = parseBlobPath(path);
  if (!rawKey) {
    return json({ error: 'not found' }, { status: 404 });
  }

  const org = await resolveOrgOrError(ctx, request);
  if (org instanceof Response) return org;

  try {
    const target = resolveTarget(rawKey, mountParam);
    const scope = await scopeOrError(ctx, org, target.mountId);
    if (scope instanceof Response) return scope;
    const store = scope.adapter;
    const absKey = scope.resolveKey(target.key);

    if (method === 'PUT') {
      const denied = await ensurePermission(
        ctx,
        request,
        org,
        PERMISSION_FILES_WRITE,
      );
      if (denied) return denied;
      const writeBlocked = writeDenied(org, scope.mount);
      if (writeBlocked) return writeBlocked;

      if (scope.isTrash(absKey)) {
        return json(
          { error: 'cannot write directly into bin; restore instead' },
          { status: 400 },
        );
      }

      const body = await readPutBody(request);
      if (body instanceof Response) return body;
      const maxBytes = maxUploadBytes(scope);
      if (body.bytes.byteLength > maxBytes) {
        return json(
          {
            error: `object exceeds max size of ${maxBytes} bytes`,
            maxBytes,
          },
          { status: 413 },
        );
      }

      await store.put(absKey, body.bytes, { contentType: body.contentType });
      invalidateLive(ctx, scope);
      await indexPutLive(
        ctx,
        scope,
        absKey,
        body.bytes.byteLength,
        body.contentType,
      );
      return json({
        ok: true,
        key: absKey,
        ref: scope.ref(absKey),
        mountId: scope.mount.id,
        bytes: body.bytes.byteLength,
        contentType: body.contentType,
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

      const read = await readObject(
        ctx,
        scope,
        absKey,
        url.searchParams.get('export') ?? undefined,
      );
      if (!read) {
        return json({ error: 'not found' }, { status: 404 });
      }
      const { bytes, contentType } = read;
      const meta = await indexGet(ctx, scope, absKey);
      if (url.searchParams.get('format') === 'json') {
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return json({
          key: absKey,
          ref: scope.ref(absKey),
          mountId: scope.mount.id,
          base64: btoa(binary),
          bytes: bytes.byteLength,
          contentType,
          name: read.name,
          updatedAt: meta?.updatedAt,
        });
      }
      const headers: Record<string, string> = {
        'content-type': contentType,
        'content-length': String(bytes.byteLength),
      };
      if (read.extension) {
        headers['content-disposition'] =
          `attachment; filename*=UTF-8''${encodeURIComponent(read.name)}`;
      }
      return new Response(bytes, { headers });
    }

    if (method === 'DELETE') {
      const denied = await ensurePermission(
        ctx,
        request,
        org,
        PERMISSION_FILES_WRITE,
      );
      if (denied) return denied;
      const writeBlocked = writeDenied(org, scope.mount);
      if (writeBlocked) return writeBlocked;

      if (scope.isTrash(absKey)) {
        await permanentDelete(ctx, scope, absKey);
        return json({ ok: true, key: absKey, purged: true });
      }

      const exists = store.stat
        ? await store.stat(absKey)
        : await store.get(absKey);
      if (!exists) {
        // Idempotent soft-delete of missing key
        return json({ ok: true, key: absKey, trashed: false, missing: true });
      }

      const retention = await retentionFor(ctx, org.orgId);
      const result = await softDeleteObject(ctx, scope, absKey, retention);
      return json({
        ok: true,
        key: absKey,
        ref: scope.ref(absKey),
        trashKey: result.trashKey,
        purgeAt: result.purgeAt,
        trashed: true,
      });
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  } catch (error) {
    return errorResponse(error);
  }
}
