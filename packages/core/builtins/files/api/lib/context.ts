import { PLATFORM_MOUNT_ID } from '@agentos/core/api/files-ref';

import {
  checkFilesPermission,
  type PermissionResult,
} from './check-permission';
import { json } from './http';
import type { FilesMountStore } from './mount-store';
import type { FilesMount, MountViewer } from './mount-types';
import { createMountScope, type MountScope } from './mount-scope';
import { createMountResolver, type MountResolver } from './mounts';
import type { FilesObjectIndex } from './object-index';
import type { FilesOrgSettingsStore } from './org-settings';
import type { PersonalTokenStore } from './personal-tokens';
import {
  resolveOrgForFilesRequest,
  type ResolveOrgResult,
} from './resolve-org';
import type { StorageProviderRegistry } from './storage-providers';
import type { BlobListResult, StorageAdapter } from './types';

/** Counts non-file records (outside the files index) that point at a mount. */
export type MountReferenceCounter = (
  orgId: string,
  mountId: string,
) => Promise<number>;

export type FilesContext = {
  /** Platform mount adapter (deployment env storage). */
  store: StorageAdapter;
  /** Persisted org / personal mounts (absent → platform mount only). */
  mounts?: FilesMountStore;
  /** Provider adapters for non-platform mounts. */
  providers?: StorageProviderRegistry;
  /** User-owned OAuth tokens of personal mounts (ticket 113). */
  tokens?: PersonalTokenStore;
  /** Override `fetch` for OAuth token exchange (tests). */
  oauthFetch?: typeof fetch;
  runtimeEnv?: Record<string, string | undefined>;
  /** Optional metadata index (db-store). */
  index?: FilesObjectIndex;
  /** Org Files settings (bin retention). */
  settings?: FilesOrgSettingsStore;
  referenceCounters?: MountReferenceCounter[];
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

export type ResolvedOrg = Extract<ResolveOrgResult, { ok: true }>;

type LiveCacheEntry = { expires: number; result: BlobListResult };

type ContextState = {
  resolver: MountResolver;
  liveCache: Map<string, LiveCacheEntry>;
};

const states = new WeakMap<FilesContext, ContextState>();

function stateFor(ctx: FilesContext): ContextState {
  let state = states.get(ctx);
  if (!state) {
    state = {
      resolver: createMountResolver({
        platform: ctx.store,
        store: ctx.mounts,
        providers: ctx.providers,
        tokens: ctx.tokens,
        runtimeEnv: ctx.runtimeEnv,
      }),
      liveCache: new Map(),
    };
    states.set(ctx, state);
  }
  return state;
}

export function mountResolver(ctx: FilesContext): MountResolver {
  return stateFor(ctx).resolver;
}

export function liveCache(ctx: FilesContext): Map<string, LiveCacheEntry> {
  return stateFor(ctx).liveCache;
}

export function viewerOf(org: ResolvedOrg): MountViewer {
  return org.userId ? { userId: org.userId, via: org.via } : { via: org.via };
}

export async function resolveOrgOrError(
  ctx: FilesContext,
  request: Request,
): Promise<ResolvedOrg | Response> {
  const resolve = ctx.resolveOrg ?? resolveOrgForFilesRequest;
  const org = await resolve(request, ctx.runtimeEnv ?? Bun.env);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  return org;
}

export async function hasPermission(
  ctx: FilesContext,
  request: Request,
  org: ResolvedOrg,
  permission: string,
): Promise<PermissionResult> {
  if (org.via === 'header') return 'ok';
  const check = ctx.checkPermission ?? checkFilesPermission;
  return check(request, permission, ctx.runtimeEnv ?? Bun.env);
}

export async function ensurePermission(
  ctx: FilesContext,
  request: Request,
  org: ResolvedOrg,
  permission: string,
): Promise<Response | null> {
  const result = await hasPermission(ctx, request, org, permission);
  if (result === 'unauthenticated') {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (result === 'denied') {
    return json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function scopeForMount(
  ctx: FilesContext,
  org: ResolvedOrg,
  mount: FilesMount,
  draftSecrets?: Record<string, string>,
): Promise<MountScope> {
  const adapter = await mountResolver(ctx).adapter(
    org.orgId,
    mount,
    draftSecrets,
  );
  return createMountScope(org.orgId, mount, adapter);
}

/** Visible mount scope by id (`default` alias allowed) or a 404 response. */
export async function scopeOrError(
  ctx: FilesContext,
  org: ResolvedOrg,
  mountId: string = PLATFORM_MOUNT_ID,
): Promise<MountScope | Response> {
  const mount = await mountResolver(ctx).get(org.orgId, mountId, viewerOf(org));
  if (!mount) {
    return json({ error: `mount not found: ${mountId}` }, { status: 404 });
  }
  return scopeForMount(ctx, org, mount);
}

/**
 * Background / peer callers (no user) may only write to org mounts; personal
 * mounts stay private to their owner.
 */
export function writeDenied(
  org: ResolvedOrg,
  mount: FilesMount,
): Response | null {
  if (mount.kind === 'personal' && org.via === 'header') {
    return json(
      { error: 'background callers may only write to org mounts' },
      { status: 403 },
    );
  }
  return null;
}
