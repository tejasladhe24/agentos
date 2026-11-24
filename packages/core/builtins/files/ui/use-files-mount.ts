import { useCallback, useEffect, useState } from 'react';
import { useHostStorage } from '@agentos/core/client';

import {
  FILES_MOUNT_CHANNEL,
  FILES_MOUNT_STORAGE_KEY,
  PLATFORM_MOUNT_ID,
} from './files-types';

function parseMountId(value: unknown): string {
  return typeof value === 'string' && value ? value : PLATFORM_MOUNT_ID;
}

/**
 * Selected mount shared across Files page + sidebar iframes (browse root).
 * Persists via host storage; live-syncs with BroadcastChannel.
 */
export function useFilesMount(): [string, (mountId: string) => Promise<void>] {
  const storage = useHostStorage();
  const [mountId, setMountId] = useState(PLATFORM_MOUNT_ID);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await storage.get(FILES_MOUNT_STORAGE_KEY);
      if (!cancelled) setMountId(parseMountId(stored));
    })();

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(FILES_MOUNT_CHANNEL)
        : null;

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        setMountId(parseMountId(event.data));
      };
    }

    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [storage]);

  const selectMount = useCallback(
    async (next: string) => {
      setMountId(next);
      await storage.set(FILES_MOUNT_STORAGE_KEY, next);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(FILES_MOUNT_CHANNEL);
        channel.postMessage(next);
        channel.close();
      }
    },
    [storage],
  );

  return [mountId, selectMount];
}
