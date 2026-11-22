import { BlobStoreError } from './blob-store-error';

/**
 * Normalize a blob key for filesystem or S3 object paths.
 * Rejects empty keys, null bytes, and `..` path segments (traversal).
 */
export function normalizeBlobKey(key: string): string {
  const trimmed = key.replace(/^\/+/, '').trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new BlobStoreError('invalid key', 400);
  }
  const segments = trimmed.split(/[/\\]+/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new BlobStoreError('invalid key', 400);
  }
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new BlobStoreError('path traversal rejected', 400);
    }
  }
  return segments.join('/');
}
