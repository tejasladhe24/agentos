import { useCallback, useEffect, useState } from 'react';
import { useHostStorage } from '@agentos/core/client';

import {
  FILES_SECTION_CHANNEL,
  FILES_SECTION_STORAGE_KEY,
  type FilesSection,
} from './files-types';

function parseSection(value: unknown): FilesSection {
  if (value === 'bin' || value === 'storage' || value === 'files') return value;
  return 'files';
}

/**
 * Shared Files nav section (My Files / Bin / Storage) across page + sidebar.
 */
export function useFilesSection(): [
  FilesSection,
  (section: FilesSection) => Promise<void>,
] {
  const storage = useHostStorage();
  const [section, setSection] = useState<FilesSection>('files');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await storage.get(FILES_SECTION_STORAGE_KEY);
      if (!cancelled) setSection(parseSection(stored));
    })();

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(FILES_SECTION_CHANNEL)
        : null;

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        setSection(parseSection(event.data));
      };
    }

    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [storage]);

  const selectSection = useCallback(
    async (next: FilesSection) => {
      setSection(next);
      await storage.set(FILES_SECTION_STORAGE_KEY, next);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(FILES_SECTION_CHANNEL);
        channel.postMessage(next);
        channel.close();
      }
    },
    [storage],
  );

  return [section, selectSection];
}
