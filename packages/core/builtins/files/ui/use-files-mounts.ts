import { useCallback, useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';

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
export function useFilesMounts(
  options: {
    usage?: boolean;
    /**
     * Toast load failures via the host notifications inbox. Enable on one
     * consumer per page: each Files iframe mounts this hook, so unconditional
     * reporting would toast once per iframe.
     */
    reportErrors?: boolean;
  } = {},
): {
  data: FilesMountsResponse;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [data, setData] = useState<FilesMountsResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const usage = options.usage === true;
  const reportErrors = options.reportErrors === true;

  const reload = useCallback(async () => {
    let res: Awaited<ReturnType<typeof api.fetch>>;
    try {
      res = await api.fetch(`/mounts${usage ? '?usage=1' : ''}`);
    } catch {
      const message = 'Could not reach storage. Reload the page to retry.';
      setError(message);
      if (reportErrors) void notifications.show(message, 'error');
      setLoading(false);
      return;
    }
    if (!res.ok) {
      const message = parseErrorBody(res.body, 'Could not load storage');
      setError(message);
      if (reportErrors) void notifications.show(message, 'error');
      setLoading(false);
      return;
    }
    try {
      setData(parseMountsResponse(res.body));
      setError(null);
    } catch {
      const message = 'Invalid storage response';
      setError(message);
      if (reportErrors) void notifications.show(message, 'error');
    }
    setLoading(false);
  }, [api, notifications, reportErrors, usage]);

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
