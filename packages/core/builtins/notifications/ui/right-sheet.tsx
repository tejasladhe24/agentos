import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostApi } from '@agentos/core/client';

import {
  loadRecentNotifications,
  type InboxFilter,
  type InboxState,
} from './inbox-model';
import { NotificationsInbox } from './notifications-inbox';

/** Lightweight refresh cadence while the sheet is open and visible. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Notifications right-sheet contribution (`ui/right-sheet.tsx`). Mounts when
 * the Shell opens the sheet, loads the in-app inbox from
 * `GET /api/ext/notifications/recent`, and polls while visible.
 */
export default function NotificationsRightSheet() {
  const api = useHostApi();
  const [state, setState] = useState<InboxState>({
    status: 'loading',
    entries: [],
  });
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [now, setNow] = useState(() => Date.now());
  // Only the latest request may update state, so out-of-order responses
  // cannot overwrite newer data.
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    const result = await loadRecentNotifications((path) => api.fetch(path));
    if (requestId !== latestRequest.current) return;
    setNow(Date.now());
    setState((prev) =>
      result.ok
        ? { status: 'ready', entries: result.entries }
        : { status: 'error', entries: prev.entries, error: result.error },
    );
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      latestRequest.current += 1;
    };
  }, [refresh]);

  const handleRefresh = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    void refresh();
  }, [refresh]);

  return (
    <div
      className="flex h-full min-h-0 flex-col p-4"
      data-slot="notifications-right-sheet"
    >
      <NotificationsInbox
        state={state}
        filter={filter}
        now={now}
        onFilterChange={setFilter}
        onRefresh={handleRefresh}
      />
    </div>
  );
}
