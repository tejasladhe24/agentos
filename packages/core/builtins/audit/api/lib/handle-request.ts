import {
  checkAuditPermission,
  type PermissionResult,
} from './check-permission';
import { PERMISSION_AUDIT_READ } from './constants';
import type { AuditEntryInput, DbStoreClient } from './db-store-client';
import { listEntriesPage, parseListFilters } from './list-query';
import { redactMeta } from './redact';
import {
  resolveOrgForAuditRequest,
  type ResolveOrgResult,
} from './resolve-org';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export type AuditContext = {
  db: DbStoreClient;
  runtimeEnv?: Record<string, string | undefined>;
  /** Override org resolution (tests). */
  resolveOrg?: (
    request: Request,
    env?: Record<string, string | undefined>,
  ) => Promise<ResolveOrgResult>;
  /** Override permission check (tests). */
  checkPermission?: (
    request: Request,
    permission: string,
    env?: Record<string, string | undefined>,
  ) => Promise<PermissionResult>;
};

async function ensureListPermission(
  ctx: AuditContext,
  request: Request,
  org: Extract<ResolveOrgResult, { ok: true }>,
): Promise<Response | null> {
  // Trusted peer header path (services / FDE with orgId) skips RBAC.
  if (org.via === 'header') return null;

  const check = ctx.checkPermission ?? checkAuditPermission;
  const result = await check(
    request,
    PERMISSION_AUDIT_READ,
    ctx.runtimeEnv ?? Bun.env,
  );
  if (result === 'unauthenticated') {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (result === 'denied') {
    return json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: 'db-store unavailable', detail: message },
    { status: 502 },
  );
}

function redactEntry<T extends { meta?: Record<string, unknown> }>(
  entry: T,
): T {
  return { ...entry, meta: redactMeta(entry.meta) };
}

/**
 * Thin Bun request router for `/api/ext/audit/*` upstream paths.
 * Persistence goes through db-store only (ADR 004).
 */
export async function handleAuditRequest(
  ctx: AuditContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const env = ctx.runtimeEnv ?? Bun.env;
  const resolveOrg = ctx.resolveOrg ?? resolveOrgForAuditRequest;

  if (method === 'GET' && path === '/health') {
    return json({ ok: true, backend: 'db-store' });
  }

  if (method === 'POST' && path === '/entries') {
    const org = await resolveOrg(request, env);
    if (!org.ok) {
      return json({ error: org.error }, { status: org.status });
    }

    const body = await readJsonBody(request);
    const action = typeof body?.action === 'string' ? body.action.trim() : '';
    if (!action) {
      return json({ error: 'action required' }, { status: 400 });
    }
    const input: AuditEntryInput = {
      action,
      actor: typeof body?.actor === 'string' ? body.actor : undefined,
      resource: typeof body?.resource === 'string' ? body.resource : undefined,
      meta:
        body?.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
          ? (body.meta as Record<string, unknown>)
          : undefined,
      orgId: org.orgId,
    };
    const entry = {
      id: crypto.randomUUID(),
      ...input,
      at: new Date().toISOString(),
    };
    try {
      const saved = await ctx.db.insert(entry);
      return json(redactEntry(saved), { status: 201 });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'GET' && path === '/entries') {
    const org = await resolveOrg(request, env);
    if (!org.ok) {
      return json({ error: org.error }, { status: org.status });
    }
    const denied = await ensureListPermission(ctx, request, org);
    if (denied) return denied;

    const parsed = parseListFilters(url);
    if ('error' in parsed) {
      return json({ error: parsed.error }, { status: 400 });
    }

    try {
      const page = await listEntriesPage(ctx.db, parsed, org.orgId);
      if ('error' in page) {
        return json({ error: page.error }, { status: 400 });
      }
      return json({
        entries: page.entries.map(redactEntry),
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      return unavailable(error);
    }
  }

  return json({ error: 'not found' }, { status: 404 });
}
