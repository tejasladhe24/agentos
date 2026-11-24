/**
 * Canonical file references for builtin `files` mounts (ticket 110):
 * `files://<mountId>/<path>` where `<path>` is relative to the mount root
 * (for the platform mount: relative to `orgs/<orgId>/`).
 */

export const FILES_REF_SCHEME = 'files://';

/** Built-in mount backed by the deployment env storage. */
export const PLATFORM_MOUNT_ID = 'platform';

/** Alias accepted by the files API for the org's default upload mount. */
export const DEFAULT_MOUNT_ALIAS = 'default';

const MOUNT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export type FileRef = { mountId: string; path: string };

export function isValidMountId(value: string): boolean {
  return MOUNT_ID_PATTERN.test(value);
}

export function isFileRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(FILES_REF_SCHEME);
}

export function formatFileRef(mountId: string, path: string): string {
  return `${FILES_REF_SCHEME}${mountId}/${path.replace(/^\/+/, '')}`;
}

/** Parse `files://<mountId>/<path>`; `null` when not a valid reference. */
export function parseFileRef(value: string): FileRef | null {
  if (!isFileRef(value)) return null;
  const rest = value.slice(FILES_REF_SCHEME.length);
  const slash = rest.indexOf('/');
  const mountId = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? '' : rest.slice(slash + 1);
  if (!isValidMountId(mountId)) return null;
  return { mountId, path };
}

/**
 * Legacy key (`orgs/<orgId>/a.txt` or org-relative `a.txt`) or reference →
 * reference. Legacy keys always resolve to the platform mount.
 */
export function toFileRef(keyOrRef: string, orgId?: string): string {
  const parsed = parseFileRef(keyOrRef);
  if (parsed) return formatFileRef(parsed.mountId, parsed.path);
  const trimmed = keyOrRef.replace(/^\/+/, '');
  let path = trimmed;
  if (orgId && trimmed.startsWith(`orgs/${orgId}/`)) {
    path = trimmed.slice(`orgs/${orgId}/`.length);
  } else if (!orgId) {
    const match = /^orgs\/[^/]+\/(.*)$/.exec(trimmed);
    if (match) path = match[1] ?? '';
  }
  return formatFileRef(PLATFORM_MOUNT_ID, path);
}

/** Org id embedded in a legacy platform key (`orgs/<orgId>/…`), if any. */
export function orgIdFromLegacyKey(key: string): string | undefined {
  const match = /^orgs\/([^/]+)\//.exec(key.replace(/^\/+/, ''));
  return match?.[1];
}
