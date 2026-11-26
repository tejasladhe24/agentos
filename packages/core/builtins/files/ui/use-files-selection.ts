import { useCallback, useEffect, useState } from 'react';
import { useHostStorage } from '@agentos/core/client';

import {
  FILES_SELECTION_CHANNEL,
  FILES_SELECTION_STORAGE_KEY,
  type FilesListItem,
} from './files-types';

function parseSelection(value: unknown): FilesListItem[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as FilesListItem[]) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as FilesListItem[]) : [];
}

/**
 * Selected items shared across Files page + right-sidebar iframes.
 * Persists via host storage; live-syncs with BroadcastChannel.
 */
export function useFilesSelection(): [
  FilesListItem[],
  (items: FilesListItem[]) => Promise<void>,
] {
  const storage = useHostStorage();
  const [selection, setSelection] = useState<FilesListItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await storage.get(FILES_SELECTION_STORAGE_KEY);
      if (!cancelled) setSelection(parseSelection(stored));
    })();

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(FILES_SELECTION_CHANNEL)
        : null;

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        setSelection(parseSelection(event.data));
      };
    }

    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [storage]);

  const updateSelection = useCallback(
    async (items: FilesListItem[]) => {
      setSelection(items);
      const serialized = JSON.stringify(items);
      await storage.set(FILES_SELECTION_STORAGE_KEY, serialized);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(FILES_SELECTION_CHANNEL);
        channel.postMessage(serialized);
        channel.close();
      }
    },
    [storage],
  );

  return [selection, updateSelection];
}
