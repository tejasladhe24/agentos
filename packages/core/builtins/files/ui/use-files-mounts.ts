import { useCallback, useEffect, useState } from 'react';
import { useHostApi } from '@agentos/core/client';

import {
  FILES_MOUNTS_CHANGED_CHANNEL,
  parseErrorBody,
  parseMountsResponse,
  PLATFORM_MOUNT_ID,
  type FilesMountsResponse,
} from './files-types';

const EMPTY: FilesMountsResponse = {
  mounts: [],
  defaultMountId: PLATFORM_MOUNT_ID,
  providers: [],
  canManage: false,
};

/** Tell other Files iframes (sidebar, page) that mounts changed. */
export function broadcastMountsChanged(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(FILES_MOUNTS_CHANGED_CHANNEL);
  channel.postMessage('changed');
  channel.close();
}

/** Visible mounts from `GET /mounts`; reloads when another view changes them. */
export function useFilesMounts(options: { usage?: boolean } = {}): {
  data: FilesMountsResponse;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const api = useHostApi();
  const [data, setData] = useState<FilesMountsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const usage = options.usage === true;

  const reload = useCallback(async () => {
    const res = await api.fetch(`/mounts${usage ? '?usage=1' : ''}`);
    if (!res.ok) {
      setError(parseErrorBody(res.body, 'Could not load storage'));
      setLoading(false);
      return;
    }
    try {
      setData(parseMountsResponse(res.body));
      setError(null);
    } catch {
      setError('Invalid storage response');
    }
    setLoading(false);
  }, [api, usage]);

  useEffect(() => {
    void reload();
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(FILES_MOUNTS_CHANGED_CHANNEL)
        : null;
    if (channel) channel.onmessage = () => void reload();
    return () => channel?.close();
  }, [reload]);

  return { data, loading, error, reload };
}
