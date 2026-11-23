import {
  PERMISSION_SECRETS_READ,
  PERMISSION_SECRETS_WRITE,
  SECRETS_ALG,
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

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
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
};

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

function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: 'db-store unavailable', detail: message },
    { status: 502 },
  );
}

/**
 * Bun request router for `/api/ext/secrets/*`.
 * GET: vault (org) then env fallback. PUT/DELETE: vault only.
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

  const key = parseSecretPath(path);
  if (!key) {
    return json({ error: 'not found' }, { status: 404 });
  }

  if (method === 'GET') {
    return handleGet(ctx, request, key);
  }
  if (method === 'PUT') {
    return handlePut(ctx, request, key);
  }
  if (method === 'DELETE') {
    return handleDelete(ctx, request, key);
  }

  return json({ error: 'not found' }, { status: 404 });
}

async function handleGet(
  ctx: SecretsContext,
  request: Request,
  key: string,
): Promise<Response> {
  const resolveOrg = ctx.resolveOrg ?? resolveOrgForSecretsRequest;
  const org = await resolveOrg(request, ctx.runtimeEnv);

  if (org.ok && ctx.db) {
    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_SECRETS_READ,
    );
    if (denied) return denied;

    const masterKey = masterKeyFromEnv(ctx.runtimeEnv);
    if (masterKey) {
      try {
        const record = await ctx.db.get(org.orgId, key);
        if (record) {
          if (record.orgId && record.orgId !== org.orgId) {
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
          return json(body);
        }
      } catch (error) {
        return unavailable(error);
      }
    }
  }

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
    PERMISSION_SECRETS_WRITE,
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
    const existing = await ctx.db.get(org.orgId, key);
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

    await ctx.db.put(org.orgId, record);

    const response: Record<string, unknown> = {
      key,
      rotatedAt: record.rotatedAt,
      version: record.version,
    };
    if (record.expiresAt) response.expiresAt = record.expiresAt;
    return json(response, { status: existing ? 200 : 201 });
  } catch (error) {
    return unavailable(error);
  }
}

async function handleDelete(
  ctx: SecretsContext,
  request: Request,
  key: string,
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
    PERMISSION_SECRETS_WRITE,
  );
  if (denied) return denied;

  try {
    const deleted = await ctx.db.delete(org.orgId, key);
    if (!deleted) {
      return json({ error: 'not found' }, { status: 404 });
    }
    return json({ key, deleted: true });
  } catch (error) {
    return unavailable(error);
  }
}
