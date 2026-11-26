import { joinPrefix, type FilesListItem } from './files-types';

export function folderPrefixFor(item: FilesListItem): string {
  if (item.kind !== 'folder') return '';
  return item.relativeKey.endsWith('/')
    ? item.relativeKey
    : `${item.relativeKey}/`;
}

export function parentOfRelativeKey(relativeKey: string): string {
  const trimmed = relativeKey.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return '';
  return `${trimmed.slice(0, idx + 1)}`;
}

export function renameTargetKey(item: FilesListItem, newName: string): string {
  const parent = parentOfRelativeKey(
    item.kind === 'folder' ? folderPrefixFor(item) : item.relativeKey,
  );
  const next =
    item.kind === 'folder'
      ? `${parent}${newName.replace(/\/+$/, '')}/`
      : joinPrefix(parent.replace(/\/$/, ''), newName);
  return next;
}

export function isReconnectError(body: string): boolean {
  try {
    return (
      (JSON.parse(body) as { code?: string }).code === 'reconnect_required'
    );
  } catch {
    return false;
  }
}
