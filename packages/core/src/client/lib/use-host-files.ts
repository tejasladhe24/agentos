import { useEffect, useState } from 'react';
import type { HostAPIClient } from '@agentos/core/sdk';
import { useHost } from './use-host';

/** Host file references (`files.blobUrl(key)`). */
export function useHostFiles(): HostAPIClient['files'] {
  return useHost().files;
}

/**
 * Same-origin download URL for a stored blob, or `null` until the host
 * resolves it (and after `key` becomes empty).
 */
export function useFilesBlobUrl(key: string | null | undefined): string | null {
  const files = useHostFiles();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void files.blobUrl(key).then(
      (resolved) => {
        if (!cancelled) setUrl(resolved);
      },
      () => {
        if (!cancelled) setUrl(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [files, key]);

  return url;
}
