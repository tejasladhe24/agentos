import { orgRootPrefix, relativeOrgKey, resolveOrgKey } from './org-key';

/** Reserved folder under each org for soft-deleted blobs. */
export const TRASH_SEGMENT = '__trash__';

export function trashRootPrefix(orgId: string): string {
  return `${orgRootPrefix(orgId)}/${TRASH_SEGMENT}/`;
}

export function isTrashKey(orgId: string, absoluteKey: string): boolean {
  return absoluteKey.startsWith(trashRootPrefix(orgId));
}

/** Live relative key → absolute trash key. */
export function toTrashKey(orgId: string, liveRelativeOrAbs: string): string {
  const abs = resolveOrgKey(orgId, liveRelativeOrAbs);
  const rel = relativeOrgKey(orgId, abs);
  if (rel.startsWith(`${TRASH_SEGMENT}/`) || rel === TRASH_SEGMENT) {
    return abs;
  }
  return `${trashRootPrefix(orgId)}${rel}`;
}

/** Trash absolute key → original live absolute key. */
export function fromTrashKey(orgId: string, trashAbsoluteKey: string): string {
  const root = trashRootPrefix(orgId);
  if (!trashAbsoluteKey.startsWith(root)) {
    return trashAbsoluteKey;
  }
  const rel = trashAbsoluteKey.slice(root.length);
  return resolveOrgKey(orgId, rel);
}

export type BinRetentionDays = 15 | 30 | null;

export function computePurgeAt(
  retentionDays: BinRetentionDays,
  from: Date = new Date(),
): string | null {
  if (retentionDays == null) return null;
  const ms = retentionDays * 24 * 60 * 60 * 1000;
  return new Date(from.getTime() + ms).toISOString();
}

export function parseRetentionDays(raw: unknown): BinRetentionDays {
  if (raw === null || raw === 'null' || raw === 'never' || raw === 0) {
    return null;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 15 || n === 30) return n;
  return 30;
}
