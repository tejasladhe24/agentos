import { PLATFORM_MOUNT_ID } from '@agentos/core/api/files-ref';

import {
  PERMISSION_FILES_MOUNTS_MANAGE,
  PERMISSION_FILES_READ,
} from './constants';
import {
  ensurePermission,
  hasPermission,
  mountResolver,
  resolveOrgOrError,
  scopeForMount,
  viewerOf,
  type FilesContext,
  type ResolvedOrg,
} from './context';
import { errorResponse, json, readJson } from './http';
import type { FilesMount, MountRecord } from './mount-types';
import { countMountObjects, mountUsage } from './scope-ops';
import type { StorageCapabilities, StorageIndexMode } from './types';

export type MountView = FilesMount & {
  capabilities?: StorageCapabilities;
  indexMode?: StorageIndexMode;
  usage?: { files: number; bytes: number };
};

const MAX_NAME_LENGTH = 80;

function parseMountPath(path: string): { id: string; action?: string } | null {
  const match = path.match(/^\/mounts\/([^/]+)(?:\/(test))?$/);
  if (!match?.[1]) return null;
  try {
    return { id: decodeURIComponent(match[1]), action: match[2] };
  } catch {
    return null;
  }
}

function toRecord(mount: FilesMount): MountRecord {
  const { builtin: _builtin, ...record } = mount;
  return record;
}

async function describeMount(
  ctx: FilesContext,
  org: ResolvedOrg,
  mount: FilesMount,
  withUsage: boolean,
): Promise<MountView> {
  try {
    const scope = await scopeForMount(ctx, org, mount);
    const view: MountView = {
      ...mount,
      capabilities: scope.adapter.capabilities,
      indexMode: scope.adapter.indexMode,
    };
    if (withUsage) view.usage = await mountUsage(ctx, scope);
    return view;
  } catch (error) {
    return {
      ...mount,
      status: mount.status === 'connected' ? 'error' : mount.status,
      statusMessage:
        error instanceof Error ? error.message : 'storage unavailable',
    };
  }
}

async function referenceCount(
  ctx: FilesContext,
  org: ResolvedOrg,
  mount: FilesMount,
): Promise<{ files: number; records: number }> {
  let files = 0;
  try {
    const scope = await scopeForMount(ctx, org, mount);
    if (scope.adapter.indexMode === 'indexed') {
      files = await countMountObjects(ctx, scope);
    }
  } catch {
    // Unreachable storage: rely on the index below.
  }
  if (ctx.index) {
    try {
      const indexed = await ctx.index.listByPrefix(
        org.orgId,
        `files://${mount.id}/`,
        2000,
      );
      files = Math.max(files, indexed.length);
    } catch {
      // ignore
    }
  }
  let records = 0;
  for (const counter of ctx.referenceCounters ?? []) {
    records += await counter(org.orgId, mount.id).catch(() => 0);
  }
  return { files, records };
}

async function saveDefault(
  ctx: FilesContext,
  org: ResolvedOrg,
  targetId: string,
): Promise<void> {
  const store = ctx.mounts!;
  const records = await store.list(org.orgId);
  const now = new Date().toISOString();
  for (const record of records) {
    if (record.kind !== 'org' || record.id === PLATFORM_MOUNT_ID) continue;
    const isDefault = record.id === targetId;
    if (record.isDefault === isDefault) continue;
    await store.put(
      org.orgId,
      { ...record, isDefault, updatedAt: now },
      { actor: org.userId },
    );
  }
}

type SecretInput = Record<string, string | null>;

/**
 * Split request config into non-secret settings and vault secrets using the
 * provider's `secretFields`; secret values never land in the mount record.
 */
function splitSecrets(
  ctx: FilesContext,
  providerId: string,
  rawConfig: unknown,
  rawSecrets: unknown,
): { config: Record<string, unknown>; secrets: SecretInput } {
  const secretFields = new Set(
    ctx.providers?.get(providerId)?.secretFields ?? [],
  );
  const config: Record<string, unknown> = {};
  const secrets: SecretInput = {};
  if (rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)) {
    for (const [key, value] of Object.entries(rawConfig)) {
      if (secretFields.has(key)) {
        if (typeof value === 'string' && value) secrets[key] = value;
      } else {
        config[key] = value;
      }
    }
  }
  if (
    rawSecrets &&
    typeof rawSecrets === 'object' &&
    !Array.isArray(rawSecrets)
  ) {
    for (const [key, value] of Object.entries(rawSecrets)) {
      if (!secretFields.has(key)) continue;
      if (value === null) secrets[key] = null;
      else if (typeof value === 'string' && value) secrets[key] = value;
    }
  }
  return { config, secrets };
}

function draftOf(secrets: SecretInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function locationChanged(
  ctx: FilesContext,
  mount: FilesMount,
  next: Record<string, unknown>,
): boolean {
  const fields = ctx.providers?.get(mount.provider)?.locationFields ?? [];
  return fields.some(
    (field) =>
      JSON.stringify(mount.config?.[field]) !== JSON.stringify(next[field]),
  );
}

/** `/mounts` routes — list, add, rename / set default, test, remove. */
export async function handleMountsRequest(
  ctx: FilesContext,
  request: Request,
  path: string,
  method: string,
): Promise<Response | null> {
  if (path !== '/mounts' && !path.startsWith('/mounts/')) return null;

  const org = await resolveOrgOrError(ctx, request);
  if (org instanceof Response) return org;
  const resolver = mountResolver(ctx);
  const viewer = viewerOf(org);

  try {
    if (path === '/mounts' && method === 'GET') {
      const denied = await ensurePermission(
        ctx,
        request,
        org,
        PERMISSION_FILES_READ,
      );
      if (denied) return denied;
      const url = new URL(request.url);
      const withUsage = url.searchParams.get('usage') === '1';
      const mounts = await resolver.list(org.orgId, viewer);
      const views = await Promise.all(
        mounts.map((m) => describeMount(ctx, org, m, withUsage)),
      );
      const canManage =
        (await hasPermission(
          ctx,
          request,
          org,
          PERMISSION_FILES_MOUNTS_MANAGE,
        )) === 'ok';
      return json({
        mounts: views,
        defaultMountId:
          mounts.find((m) => m.isDefault)?.id ?? PLATFORM_MOUNT_ID,
        providers: (ctx.providers?.list() ?? []).map((p) => ({
          id: p.id,
          label: p.label,
          icon: p.icon,
          orgAddable: p.orgAddable,
          personal: Boolean(p.personal),
          ...(p.fields ? { fields: p.fields } : {}),
          ...(p.presets ? { presets: p.presets } : {}),
        })),
        canManage,
      });
    }

    const denied = await ensurePermission(
      ctx,
      request,
      org,
      PERMISSION_FILES_MOUNTS_MANAGE,
    );
    if (denied) return denied;

    const isDraftTest = path === '/mounts/test' && method === 'POST';
    if ((path === '/mounts' && method === 'POST') || isDraftTest) {
      const body = await readJson<{
        provider?: unknown;
        name?: unknown;
        config?: unknown;
        secrets?: unknown;
        isDefault?: unknown;
      }>(request);
      if (body instanceof Response) return body;
      const provider =
        typeof body.provider === 'string'
          ? ctx.providers?.get(body.provider)
          : undefined;
      if (!provider?.orgAddable) {
        return json(
          { error: 'storage provider not available for org mounts' },
          { status: 400 },
        );
      }
      const name =
        typeof body.name === 'string'
          ? body.name.trim()
          : isDraftTest
            ? 'draft'
            : '';
      if (!name || name.length > MAX_NAME_LENGTH) {
        return json(
          { error: `name required (max ${MAX_NAME_LENGTH} characters)` },
          { status: 400 },
        );
      }
      if (!ctx.mounts && !isDraftTest) {
        return json({ error: 'mount storage unavailable' }, { status: 503 });
      }
      const { config, secrets } = splitSecrets(
        ctx,
        provider.id,
        body.config,
        body.secrets,
      );
      const now = new Date().toISOString();
      const mount: FilesMount = {
        id: `m_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        kind: 'org',
        provider: provider.id,
        name,
        isDefault: false,
        status: 'connected',
        config,
        createdAt: now,
        updatedAt: now,
      };
      let failure: string | undefined;
      try {
        const scope = await scopeForMount(ctx, org, mount, draftOf(secrets));
        await (scope.adapter.test?.() ??
          scope.adapter.list({ prefix: scope.root, limit: 1, delimiter: '/' }));
      } catch (error) {
        failure = error instanceof Error ? error.message : 'unknown error';
      }
      if (isDraftTest) {
        return json(failure ? { ok: false, error: failure } : { ok: true });
      }
      if (failure) {
        return json(
          { error: `connection test failed: ${failure}` },
          { status: 400 },
        );
      }
      const saved = await ctx.mounts!.put(org.orgId, toRecord(mount), {
        secrets,
        actor: org.userId,
      });
      if (body.isDefault === true) {
        await saveDefault(ctx, org, mount.id);
      }
      const created = await resolver.get(org.orgId, mount.id, viewer);
      return json(
        { ok: true, mount: created ?? { ...mount, ...saved } },
        { status: 201 },
      );
    }

    const target = parseMountPath(path);
    if (!target) return json({ error: 'not found' }, { status: 404 });
    const mount = await resolver.get(org.orgId, target.id, viewer);
    if (!mount) {
      return json({ error: `mount not found: ${target.id}` }, { status: 404 });
    }

    if (target.action === 'test' && method === 'POST') {
      let ok = true;
      let message: string | undefined;
      try {
        const scope = await scopeForMount(ctx, org, mount);
        await (scope.adapter.test?.() ??
          scope.adapter.list({ prefix: scope.root, limit: 1, delimiter: '/' }));
      } catch (error) {
        ok = false;
        message = error instanceof Error ? error.message : 'unknown error';
      }
      const status = ok ? 'connected' : 'error';
      if (!mount.builtin && ctx.mounts && mount.status !== status) {
        const record: MountRecord = {
          ...toRecord(mount),
          status,
          updatedAt: new Date().toISOString(),
        };
        if (message) record.statusMessage = message;
        else delete record.statusMessage;
        await ctx.mounts.put(org.orgId, record, { actor: org.userId });
      }
      return json(message ? { ok, status, error: message } : { ok, status });
    }

    if (target.action) return json({ error: 'not found' }, { status: 404 });

    if (method === 'PATCH') {
      const body = await readJson<{
        name?: unknown;
        isDefault?: unknown;
        config?: unknown;
        secrets?: unknown;
      }>(request);
      if (body instanceof Response) return body;
      if (!ctx.mounts) {
        return json({ error: 'mount storage unavailable' }, { status: 503 });
      }
      const next: MountRecord = { ...toRecord(mount) };
      let secrets: SecretInput = {};
      if ('name' in body) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name || name.length > MAX_NAME_LENGTH) {
          return json(
            { error: `name required (max ${MAX_NAME_LENGTH} characters)` },
            { status: 400 },
          );
        }
        next.name = name;
      }
      if ('config' in body || 'secrets' in body) {
        if (mount.builtin) {
          return json(
            { error: 'platform mount is configured by the deployment env' },
            { status: 400 },
          );
        }
        const split = splitSecrets(
          ctx,
          mount.provider,
          'config' in body ? body.config : (mount.config ?? {}),
          body.secrets,
        );
        const config = split.config;
        secrets = split.secrets;
        if (locationChanged(ctx, mount, config)) {
          const refs = await referenceCount(ctx, org, mount);
          if (refs.files + refs.records > 0) {
            return json(
              {
                error:
                  'mount holds files; changing its location is blocked — add a new mount instead',
                references: refs.files + refs.records,
                ...refs,
              },
              { status: 409 },
            );
          }
        }
        next.config = config;
      }
      if (body.isDefault === true) {
        if (mount.kind !== 'org') {
          return json(
            { error: 'personal mounts cannot be the org default' },
            { status: 400 },
          );
        }
        await saveDefault(ctx, org, mount.id);
        next.isDefault = !mount.builtin;
      } else if (body.isDefault === false && mount.isDefault) {
        return json(
          { error: 'set another mount as default instead' },
          { status: 400 },
        );
      }
      const changed =
        next.name !== mount.name ||
        JSON.stringify(next.config) !== JSON.stringify(mount.config) ||
        Object.keys(secrets).length > 0;
      if (changed || (body.isDefault === true && !mount.builtin)) {
        next.updatedAt = new Date().toISOString();
        if (mount.builtin) {
          await ctx.mounts.put(
            org.orgId,
            {
              id: PLATFORM_MOUNT_ID,
              kind: 'org',
              provider: mount.provider,
              name: next.name,
              isDefault: false,
              status: 'connected',
              updatedAt: next.updatedAt,
            },
            { actor: org.userId },
          );
        } else {
          await ctx.mounts.put(org.orgId, next, {
            secrets,
            actor: org.userId,
          });
        }
      }
      const updated = await resolver.get(org.orgId, mount.id, viewer);
      return json({ ok: true, mount: updated });
    }

    if (method === 'DELETE') {
      if (mount.builtin) {
        return json(
          { error: 'the platform mount cannot be removed' },
          { status: 400 },
        );
      }
      const refs = await referenceCount(ctx, org, mount);
      const total = refs.files + refs.records;
      if (total > 0) {
        return json(
          {
            error: `mount is referenced by ${total} item(s); move or delete them first`,
            references: total,
            ...refs,
          },
          { status: 409 },
        );
      }
      await ctx.mounts?.delete(org.orgId, mount.id, org.userId);
      return json({ ok: true, id: mount.id });
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  } catch (error) {
    return errorResponse(error);
  }
}
