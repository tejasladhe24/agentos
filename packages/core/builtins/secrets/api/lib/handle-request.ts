import { appendEntry } from '@agentos/core/api/audit';
import { publish } from '@agentos/core/api/events';

import {
  MANAGED_KEY_PREFIX,
  PERMISSION_SECRETS_READ,
  PERMISSION_SECRETS_WRITE,
  SECRETS_ALG,
  SECRETS_USER_PURGED_TOPIC,
} from './constants';
import {
  checkSecretsPermission,
  type PermissionResult,
} from './check-permission';
import { decryptSecret, encryptSecret, parseMasterKey } from './crypto';
import type { SecretsDbStoreClient, VaultRecord } from './db-store-client';
import {
  resolveOrgForSecretsRequest,
  type ResolveOrgResult,
} from './resolve-org';
import { resolveSecret } from './resolve-secret';
import { validateSecretKey } from './validate-key';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function parsePurgeUserPath(path: string): string | null {
  const match = path.match(/^\/users\/([^/]+)\/purge$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** `?ownerUserId=` selects a user-owned record; absent → org-owned. */
function readOwnerUserId(url: URL): string | undefined {
  const raw = url.searchParams.get('ownerUserId')?.trim();
  return raw ? raw : undefined;
}

function parseSecretPath(path: string): string | null {
  const match = path.match(/^\/secrets\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
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

export type SecretsContext = {
  runtimeEnv: Record<string, string | undefined>;
  /** db-store client for vault; omit for env-only mode. */
  db?: SecretsDbStoreClient;
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
  /** Override audit append (tests); default best-effort HTTP. */
  appendAudit?: (input: {
    action: string;
    resource?: string;
    meta?: Record<string, unknown>;
    orgId?: string;
  }) => Promise<void>;
  /** Override event publish (tests); default best-effort HTTP to `events`. */
  publishEvent?: (topic: string, payload: unknown) => Promise<void>;
};

type ResolvedOrg = Extract<ResolveOrgResult, { ok: true }>;

function masterKeyFromEnv(
  runtimeEnv: Record<string, string | undefined>,
): Uint8Array | null {
  return parseMasterKey(runtimeEnv.AGENT_OS_EXT_SECRETS_MASTER_KEY);
}

async function ensurePermission(
  ctx: SecretsContext,
  request: Request,
  org: Extract<ResolveOrgResult, { ok: true }>,
  permission: string,
): Promise<Response | null> {
  // Trusted peer header path (services / FDE with orgId) skips RBAC.
  if (org.via === 'header') return null;

  const check = ctx.checkPermission ?? checkSecretsPermission;
  const result = await check(request, permission, ctx.runtimeEnv);
  if (result === 'unauthenticated') {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (result === 'denied') {
    return json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * User-owned rows: only the owner (session user, or a peer acting for them via
 * `X-AgentOS-User-Id`). `secrets.read` / `secrets.write` never grant access.
 */
async function ensureAccess(
  ctx: SecretsContext,
  request: Request,
  org: ResolvedOrg,
  permission: string,
  ownerUserId: string | undefined,
): Promise<Response | null> {
  if (!ownerUserId) return ensurePermission(ctx, request, org, permission);
  if (org.userId === ownerUserId) return null;
  if (org.via === 'header' && !org.userId) {
    return json(
      { error: 'X-AgentOS-User-Id required for user-owned secrets' },
      { status: 403 },
    );
  }
  return json({ error: 'forbidden' }, { status: 403 });
}

async function hasWritePermission(
  ctx: SecretsContext,
  request: Request,
  org: Extract<ResolveOrgResult, { ok: true }>,
): Promise<boolean> {
  if (org.via === 'header') return true;
  const check = ctx.checkPermission ?? checkSecretsPermission;
  const result = await check(request, PERMISSION_SECRETS_WRITE, ctx.runtimeEnv);
  return result === 'ok';
}

function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: 'db-store unavailable', detail: message },
    { status: 502 },
  );
}

async function recordAudit(
  ctx: SecretsContext,
  action: 'secrets.put' | 'secrets.delete' | 'secrets.user_purged',
  orgId: string,
  resource: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    if (ctx.appendAudit) {
      await ctx.appendAudit({ action, resource, meta, orgId });
      return;
    }
    await appendEntry({ action, resource, meta }, ctx.runtimeEnv, { orgId });
  } catch {
    // Best-effort — never fail the secret op or log the value.
  }
}

function auditMeta(key: string, ownerUserId?: string): Record<string, unknown> {
  return ownerUserId ? { key, ownerUserId } : { key };
}

async function publishEvent(
  ctx: SecretsContext,
  topic: string,
  payload: unknown,
): Promise<void> {
  try {
    if (ctx.publishEvent) {
      await ctx.publishEvent(topic, payload);
      return;
    }
    await publish(topic, payload, ctx.runtimeEnv);
  } catch {
    // Best-effort — consumers can reconcile from the audit log.
  }
}

/**
 * Bun request router for `/api/ext/secrets/*`.
 * GET list: metadata only. GET key: vault then env. PUT/DELETE: vault only.
 */
export async function handleSecretsRequest(
  ctx: SecretsContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({
      ok: true,
      vault: Boolean(ctx.db),
      masterKey: Boolean(masterKeyFromEnv(ctx.runtimeEnv)),
    });
  }

  if (method === 'GET' && path === '/secrets') {
    return handleList(ctx, request);
  }

  const purgeUserId = parsePurgeUserPath(path);
  if (purgeUserId && method === 'POST') {
    return handlePurgeUser(ctx, request, purgeUserId);
  }

  const key = parseSecretPath(path);
  if (!key) {
    return json({ error: 'not found' }, { status: 404 });
  }

  if (key.startsWith(MANAGED_KEY_PREFIX)) {
    const resolveOrg = ctx.resolveOrg ?? resolveOrgForSecretsRequest;
    const org = await resolveOrg(request, ctx.runtimeEnv);
    if (!org.ok || org.via !== 'header') {
      return json(
        { error: 'managed by integrations; edit it in Settings' },
        { status: 403 },
      );
    }
  }

  const ownerUserId = readOwnerUserId(url);
  if (method === 'GET') {
    return handleGet(ctx, request, key, ownerUserId);
  }
  if (method === 'PUT') {
    return handlePut(ctx, request, key, ownerUserId);
  }
  if (method === 'DELETE') {
    return handleDelete(ctx, request, key, ownerUserId);
  }

  return json({ error: 'not found' }, { status: 404 });
}

async function handleList(
  ctx: SecretsContext,
  request: Request,
): Promise<Response> {
  if (!ctx.db) {
    return json({ error: 'vault unavailable' }, { status: 503 });
  }

  const resolveOrg = ctx.resolveOrg ?? resolveOrgForSecretsRequest;
  const org = await resolveOrg(request, ctx.runtimeEnv);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }

  const denied = await ensurePermission(
    ctx,
    request,
    org,
    PERMISSION_SECRETS_READ,
  );
  if (denied) return denied;

  try {
    const records = (await ctx.db.list(org.orgId)).filter(
      (record) => !record.ownerUserId,
    );
    const canWrite = await hasWritePermission(ctx, request, org);
    const keys = records.map((record) => {
      const item: Record<string, unknown> = {
        key: record.key,
        hasValue: true,
      };
      if (record.rotatedAt) item.updatedAt = record.rotatedAt;
      if (record.expiresAt) item.expiresAt = record.expiresAt;
      if (record.key.startsWith(MANAGED_KEY_PREFIX)) item.managed = true;
      return item;
    });
    return json({ orgId: org.orgId, canWrite, keys });
  } catch (error) {
    return unavailable(error);
  }
}

async function handleGet(
  ctx: SecretsContext,
  request: Request,
  key: string,
  ownerUserId: string | undefined,
): Promise<Response> {
  const resolveOrg = ctx.resolveOrg ?? resolveOrgForSecretsRequest;
  const org = await resolveOrg(request, ctx.runtimeEnv);

  if (ownerUserId) {
    if (!org.ok) return json({ error: org.error }, { status: org.status });
    if (!ctx.db) return json({ error: 'vault unavailable' }, { status: 503 });
  }

  if (org.ok && ctx.db) {
    const denied = await ensureAccess(
      ctx,
      request,
      org,
      PERMISSION_SECRETS_READ,
      ownerUserId,
    );
    if (denied) return denied;

    const masterKey = masterKeyFromEnv(ctx.runtimeEnv);
    if (masterKey) {
      try {
        const record = await ctx.db.get(org.orgId, key, ownerUserId);
        if (record) {
          if (
            (record.orgId && record.orgId !== org.orgId) ||
            record.ownerUserId !== ownerUserId
          ) {
            return json({ error: 'not found' }, { status: 404 });
          }
          const value = await decryptSecret(
            {
              ciphertext: record.ciphertext,
              iv: record.iv,
              alg: record.alg,
            },
            masterKey,
          );
          const body: Record<string, unknown> = {
            key,
            value,
            rotatedAt: record.rotatedAt,
            version: record.version,
            source: 'vault',
          };
          if (record.expiresAt) body.expiresAt = record.expiresAt;
          if (record.ownerUserId) body.ownerUserId = record.ownerUserId;
          return json(body);
        }
      } catch (error) {
        return unavailable(error);
      }
    }
  }

  if (ownerUserId) return json({ error: 'not found' }, { status: 404 });

  // Env fallback (bootstrap / local demos) — no org required.
  const value = resolveSecret(key, ctx.runtimeEnv);
  if (value === null) {
    return json({ error: 'not found' }, { status: 404 });
  }
  return json({ key, value, source: 'env' });
}

async function handlePut(
  ctx: SecretsContext,
  request: Request,
  key: string,
  ownerUserId: string | undefined,
): Promise<Response> {
  const keyError = validateSecretKey(key);
  if (keyError) {
    return json({ error: keyError }, { status: 400 });
  }

  if (!ctx.db) {
    return json({ error: 'vault unavailable' }, { status: 503 });
  }

  const resolveOrg = ctx.resolveOrg ?? resolveOrgForSecretsRequest;
  const org = await resolveOrg(request, ctx.runtimeEnv);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }

  const denied = await ensureAccess(
    ctx,
    request,
    org,
    PERMISSION_SECRETS_WRITE,
    ownerUserId,
  );
  if (denied) return denied;

  const masterKey = masterKeyFromEnv(ctx.runtimeEnv);
  if (!masterKey) {
    return json(
      { error: 'AGENT_OS_EXT_SECRETS_MASTER_KEY required for vault writes' },
      { status: 503 },
    );
  }

  const body = await readJsonBody(request);
  const value = typeof body?.value === 'string' ? body.value : '';
  if (!value) {
    return json({ error: 'value required' }, { status: 400 });
  }
  const expiresAt =
    typeof body?.expiresAt === 'string' && body.expiresAt.trim()
      ? body.expiresAt.trim()
      : undefined;

  try {
    const existing = await ctx.db.get(org.orgId, key, ownerUserId);
    const encrypted = await encryptSecret(value, masterKey);
    const record: VaultRecord = {
      key,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      alg: SECRETS_ALG,
      rotatedAt: new Date().toISOString(),
      version: (existing?.version ?? 0) + 1,
    };
    if (expiresAt) record.expiresAt = expiresAt;
    if (ownerUserId) record.ownerUserId = ownerUserId;

    await ctx.db.put(org.orgId, record);
    await recordAudit(
      ctx,
      'secrets.put',
      org.orgId,
      key,
      auditMeta(key, ownerUserId),
    );

    const response: Record<string, unknown> = {
      key,
      rotatedAt: record.rotatedAt,
      version: record.version,
    };
    if (record.expiresAt) response.expiresAt = record.expiresAt;
    if (ownerUserId) response.ownerUserId = ownerUserId;
    return json(response, { status: existing ? 200 : 201 });
  } catch (error) {
    return unavailable(error);
  }
}

async function handleDelete(
  ctx: SecretsContext,
  request: Request,
  key: string,
  ownerUserId: string | undefined,
): Promise<Response> {
  if (!ctx.db) {
    return json({ error: 'vault unavailable' }, { status: 503 });
  }

  const resolveOrg = ctx.resolveOrg ?? resolveOrgForSecretsRequest;
  const org = await resolveOrg(request, ctx.runtimeEnv);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }

  const denied = await ensureAccess(
    ctx,
    request,
    org,
    PERMISSION_SECRETS_WRITE,
    ownerUserId,
  );
  if (denied) return denied;

  try {
    const deleted = await ctx.db.delete(org.orgId, key, ownerUserId);
    if (!deleted) {
      return json({ error: 'not found' }, { status: 404 });
    }
    await recordAudit(
      ctx,
      'secrets.delete',
      org.orgId,
      key,
      auditMeta(key, ownerUserId),
    );
    return json({ key, deleted: true });
  } catch (error) {
    return unavailable(error);
  }
}

/**
 * Offboarding: delete every user-owned secret of `userId` in the peer org.
 * Trusted peer only (builtin auth calls this after removing an org member).
 */
async function handlePurgeUser(
  ctx: SecretsContext,
  request: Request,
  userId: string,
): Promise<Response> {
  if (!ctx.db) {
    return json({ error: 'vault unavailable' }, { status: 503 });
  }

  const resolveOrg = ctx.resolveOrg ?? resolveOrgForSecretsRequest;
  const org = await resolveOrg(request, ctx.runtimeEnv);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  if (org.via !== 'header') {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const owned = await ctx.db.listOwnedBy(org.orgId, userId);
    let deleted = 0;
    for (const record of owned) {
      if (record.ownerUserId !== userId) continue;
      if (await ctx.db.delete(org.orgId, record.key, userId)) deleted += 1;
    }
    const purgedAt = new Date().toISOString();
    await recordAudit(ctx, 'secrets.user_purged', org.orgId, userId, {
      ownerUserId: userId,
      count: deleted,
    });
    await publishEvent(ctx, SECRETS_USER_PURGED_TOPIC, {
      orgId: org.orgId,
      userId,
      count: deleted,
      purgedAt,
    });
    return json({ orgId: org.orgId, userId, deleted });
  } catch (error) {
    return unavailable(error);
  }
}
