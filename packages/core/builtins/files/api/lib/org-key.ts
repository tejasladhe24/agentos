import { BlobStoreError } from './blob-store-error';
import { normalizeBlobKey } from './normalize-key';

/** Physical key root for an org: `orgs/<orgId>`. */
export function orgRootPrefix(orgId: string): string {
  return `orgs/${normalizeBlobKey(orgId)}`;
}

/**
 * Resolve a caller key into an absolute org-scoped key.
 * Relative keys (`docs/a.txt`) become `orgs/<orgId>/docs/a.txt`.
 * Absolute keys must already live under that org root.
 */
export function resolveOrgKey(orgId: string, key: string): string {
  const normalized = normalizeBlobKey(key);
  const root = orgRootPrefix(orgId);
  if (normalized === root || normalized.startsWith(`${root}/`)) {
    return normalized;
  }
  if (normalized.startsWith('orgs/')) {
    throw new BlobStoreError('key outside org namespace', 403);
  }
  return `${root}/${normalized}`;
}

/** Normalize a list/search prefix under the org root (empty → org root + `/`). */
export function resolveOrgPrefix(orgId: string, prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, '').trim();
  if (!trimmed) {
    return `${orgRootPrefix(orgId)}/`;
  }
  const abs = resolveOrgKey(orgId, trimmed);
  return abs.endsWith('/') ? abs : `${abs}/`;
}

/** Display name (last path segment) for a key or folder prefix. */
export function keyBasename(key: string): string {
  const trimmed = key.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

/** Relative key under org root for UI (strips `orgs/<orgId>/`). */
export function relativeOrgKey(orgId: string, absoluteKey: string): string {
  const root = orgRootPrefix(orgId);
  if (absoluteKey === root) return '';
  if (absoluteKey.startsWith(`${root}/`)) {
    return absoluteKey.slice(root.length + 1);
  }
  return absoluteKey;
}
