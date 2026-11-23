import { useCallback, useEffect, useState } from 'react';
import { useHostStorage } from '@agentos/core/client';

import { FILES_PREFIX_CHANNEL, FILES_PREFIX_STORAGE_KEY } from './files-types';

function parsePrefix(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Shared browse prefix across Files page + sidebar iframes.
 * Persists via host storage; live-syncs with BroadcastChannel.
 */
export function useFilesPrefix(): [string, (prefix: string) => Promise<void>] {
  const storage = useHostStorage();
  const [prefix, setPrefix] = useState('');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await storage.get(FILES_PREFIX_STORAGE_KEY);
      if (!cancelled) {
        setPrefix(parsePrefix(stored));
      }
    })();

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(FILES_PREFIX_CHANNEL)
        : null;

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        setPrefix(parsePrefix(event.data));
      };
    }

    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [storage]);

  const selectPrefix = useCallback(
    async (next: string) => {
      setPrefix(next);
      await storage.set(FILES_PREFIX_STORAGE_KEY, next);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(FILES_PREFIX_CHANNEL);
        channel.postMessage(next);
        channel.close();
      }
    },
    [storage],
  );

  return [prefix, selectPrefix];
}
