import { formatFileRef, PLATFORM_MOUNT_ID } from '@agentos/core/api/files-ref';

import { normalizeBlobKey } from './normalize-key';
import { orgRootPrefix, relativeOrgKey, resolveOrgKey } from './org-key';
import type { FilesMount } from './mount-types';
import { TRASH_SEGMENT } from './trash';
import type { StorageAdapter } from './types';

/**
 * Key math for one mount as seen by one org. Adapter keys are absolute;
 * callers pass mount-relative paths (or legacy `orgs/<orgId>/…` keys for the
 * platform mount).
 */
export type MountScope = {
  orgId: string;
  mount: FilesMount;
  adapter: StorageAdapter;
  /** Absolute key root inside the adapter (`orgs/<orgId>/` or config prefix). */
  root: string;
  trashRoot: string;
  resolveKey: (key: string) => string;
  /** List prefix (always ends with `/`, or empty for an unprefixed root). */
  resolvePrefix: (prefix: string) => string;
  relative: (absKey: string) => string;
  ref: (absKey: string) => string;
  /** db-store index id — legacy absolute key for platform, ref otherwise. */
  indexKey: (absKey: string) => string;
  isTrash: (absKey: string) => boolean;
  toTrash: (absKey: string) => string;
  fromTrash: (trashAbsKey: string) => string;
};

function configPrefix(mount: FilesMount): string {
  const raw = mount.config?.prefix;
  if (typeof raw !== 'string' || !raw.replace(/\/+/g, '').trim()) return '';
  return `${normalizeBlobKey(raw)}/`;
}

export function createMountScope(
  orgId: string,
  mount: FilesMount,
  adapter: StorageAdapter,
): MountScope {
  const isPlatform = mount.id === PLATFORM_MOUNT_ID;
  const root = isPlatform ? `${orgRootPrefix(orgId)}/` : configPrefix(mount);
  const trashRoot = `${root}${TRASH_SEGMENT}/`;

  const resolveKey = (key: string): string => {
    if (isPlatform) return resolveOrgKey(orgId, key);
    const normalized = normalizeBlobKey(key);
    if (root && `${normalized}/`.startsWith(root)) return normalized;
    return `${root}${normalized}`;
  };

  const relative = (absKey: string): string => {
    if (isPlatform) return relativeOrgKey(orgId, absKey);
    if (root && absKey.startsWith(root)) return absKey.slice(root.length);
    return absKey;
  };

  const ref = (absKey: string): string =>
    formatFileRef(mount.id, relative(absKey));

  return {
    orgId,
    mount,
    adapter,
    root,
    trashRoot,
    resolveKey,
    resolvePrefix(prefix) {
      const trimmed = prefix.replace(/^\/+/, '').trim();
      if (!trimmed) return root;
      const abs = resolveKey(trimmed);
      return abs.endsWith('/') ? abs : `${abs}/`;
    },
    relative,
    ref,
    indexKey: (absKey) => (isPlatform ? absKey : ref(absKey)),
    isTrash: (absKey) => absKey.startsWith(trashRoot),
    toTrash(absKey) {
      if (absKey.startsWith(trashRoot)) return absKey;
      return `${trashRoot}${relative(absKey)}`;
    },
    fromTrash(trashAbsKey) {
      if (!trashAbsKey.startsWith(trashRoot)) return trashAbsKey;
      return resolveKey(trashAbsKey.slice(trashRoot.length));
    },
  };
}
