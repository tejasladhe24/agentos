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
  keyBasename,
  relativeOrgKey,
  resolveOrgKey,
  resolveOrgPrefix,
} from './org-key';
import {
  resolveOrgForFilesRequest,
  type ResolveOrgResult,
} from './resolve-org';

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

async function indexPut(
  ctx: FilesContext,
  orgId: string,
  key: string,
  bytes: number,
  contentType: string,
): Promise<void> {
  if (!ctx.index) return;
  const record: ObjectMetaRecord = {
    key,
    name: keyBasename(key),
    bytes,
    contentType,
    updatedAt: new Date().toISOString(),
  };
  try {
    await ctx.index.put(orgId, record);
  } catch {
    // Index is best-effort; blob write already succeeded.
  }
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
  if (ctx.index) {
    try {
      const meta = await ctx.index.get(orgId, key);
      if (meta) {
        contentType = meta.contentType;
        metaBytes = meta.bytes ?? metaBytes;
        metaUpdated = meta.updatedAt ?? metaUpdated;
      }
    } catch {
      // ignore
    }
  }
  return {
    key,
    name: keyBasename(key),
    kind: 'file',
    bytes: metaBytes,
    contentType,
    updatedAt: metaUpdated,
    relativeKey: relativeOrgKey(orgId, key),
  };
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

  // GET /blobs — list or search
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

    const q = url.searchParams.get('q')?.trim() ?? '';
    const limit = Math.min(
      Number(url.searchParams.get('limit') || LIST_PAGE_SIZE) || LIST_PAGE_SIZE,
      1000,
    );
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const rawPrefix = url.searchParams.get('prefix') ?? '';

    try {
      if (q && ctx.index) {
        const hits = await ctx.index.searchByName(org.orgId, q, limit);
        const items: ListedItem[] = hits.map((h) => ({
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
      const listed = await store.list({
        prefix: absPrefix,
        limit,
        cursor,
        delimiter: '/',
      });

      const items: ListedItem[] = [];
      for (const prefix of listed.prefixes) {
        items.push({
          key: prefix,
          name: keyBasename(prefix),
          kind: 'folder',
          relativeKey: relativeOrgKey(org.orgId, prefix),
        });
      }
      for (const obj of listed.objects) {
        // Skip the prefix "directory marker" if present
        if (obj.key === absPrefix || obj.key.endsWith('/')) continue;
        items.push(
          await enrichFile(ctx, org.orgId, obj.key, obj.bytes, obj.updatedAt),
        );
      }

      // Fallback name filter when no index
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
      });
    } catch (error) {
      if (error instanceof BlobStoreError) {
        return json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  // DELETE /blobs?prefix= — recursive folder delete
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
      const listed = await store.list({
        prefix: absPrefix,
        limit: 1000,
        delimiter: '',
      });
      let deleted = 0;
      for (const obj of listed.objects) {
        await store.delete(obj.key);
        await indexDelete(ctx, org.orgId, obj.key);
        deleted += 1;
      }
      // Keep paging until empty
      let cursor = listed.cursor;
      while (cursor) {
        const page = await store.list({
          prefix: absPrefix,
          limit: 1000,
          cursor,
          delimiter: '',
        });
        for (const obj of page.objects) {
          await store.delete(obj.key);
          await indexDelete(ctx, org.orgId, obj.key);
          deleted += 1;
        }
        cursor = page.cursor;
      }
      return json({ ok: true, deleted, prefix: absPrefix });
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
        const listed = await store.list({
          prefix: fromPrefix,
          limit: 1000,
          delimiter: '',
        });
        const moved: string[] = [];
        const all = [...listed.objects];
        let cursor = listed.cursor;
        while (cursor) {
          const page = await store.list({
            prefix: fromPrefix,
            limit: 1000,
            cursor,
            delimiter: '',
          });
          all.push(...page.objects);
          cursor = page.cursor;
        }
        for (const obj of all) {
          const suffix = obj.key.slice(fromPrefix.length);
          const dest = `${toPrefix}${suffix}`;
          await store.copy(obj.key, dest);
          await store.delete(obj.key);
          const meta = ctx.index
            ? await ctx.index.get(org.orgId, obj.key).catch(() => undefined)
            : undefined;
          await indexDelete(ctx, org.orgId, obj.key);
          await indexPut(
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
      await indexPut(
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
        // Prefer explicit x-agentos-content-type, else raw content-type (not octet-stream).
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
      await indexPut(
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

      await store.delete(absKey);
      await indexDelete(ctx, org.orgId, absKey);
      return json({ ok: true, key: absKey });
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  } catch (error) {
    if (error instanceof BlobStoreError) {
      return json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
