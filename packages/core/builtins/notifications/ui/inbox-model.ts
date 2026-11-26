/**
 * Pure model for the Notifications right-sheet inbox (ticket 138).
 *
 * Kept free of React and host imports so the fetch/filter/format rules are
 * unit-testable under `bun test` without a DOM.
 */

export type InboxSeverity = 'error' | 'warning' | 'success' | 'info';
export type InboxFilter = 'all' | InboxSeverity;

/** One row from `GET /api/ext/notifications/recent`. */
export type InboxEntry = {
  id: string;
  message: string;
  /** Raw `type` from the API. Unknown values render as `info`. */
  type: string;
  at: string;
  subject?: string;
  error?: string;
  /** Source extension (ticket 139). Omitted when absent. */
  extensionId?: string;
};

export type InboxState = {
  status: 'loading' | 'ready' | 'error';
  entries: InboxEntry[];
  /** Set when `status` is `error`. Entries from the last good load are kept. */
  error?: string;
};

export const INBOX_FILTERS: ReadonlyArray<{
  id: InboxFilter;
  label: string;
  emptyText: string;
}> = [
  { id: 'all', label: 'All', emptyText: 'No notifications yet' },
  { id: 'error', label: 'Errors', emptyText: 'No error notifications' },
  { id: 'warning', label: 'Warnings', emptyText: 'No warning notifications' },
  { id: 'info', label: 'Info', emptyText: 'No info notifications' },
  { id: 'success', label: 'Success', emptyText: 'No success notifications' },
];

export const SEVERITY_LABEL: Record<InboxSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  success: 'Success',
  info: 'Info',
};

/** Minimal fetch surface, so tests can pass a fake without the host SDK. */
export type RecentFetcher = (path: string) => Promise<{
  ok: boolean;
  status: number;
  body: string;
}>;

export const RECENT_PATH = '/recent';

export function severityOf(type: string): InboxSeverity {
  if (type === 'error' || type === 'warning' || type === 'success') {
    return type;
  }
  return 'info';
}

export function filterEntries(
  entries: readonly InboxEntry[],
  filter: InboxFilter,
): InboxEntry[] {
  if (filter === 'all') return [...entries];
  return entries.filter((entry) => severityOf(entry.type) === filter);
}

/** Newest first. Stable for equal timestamps. Invalid dates sort last. */
export function sortNewestFirst(entries: readonly InboxEntry[]): InboxEntry[] {
  const time = (at: string) => {
    const value = Date.parse(at);
    return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
  };
  return [...entries].sort((a, b) => time(b.at) - time(a.at));
}

/**
 * Short relative label ("just now", "5m ago", "3h ago", "2d ago"), falling back
 * to a locale date for anything older than a week. Unparseable input is
 * returned as-is so the row still shows something.
 */
export function formatRelativeTime(at: string, now: number): string {
  const timestamp = Date.parse(at);
  if (Number.isNaN(timestamp)) return at;
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatAbsoluteTime(at: string): string {
  const timestamp = Date.parse(at);
  if (Number.isNaN(timestamp)) return at;
  return new Date(timestamp).toLocaleString();
}

function normalizeEntry(raw: unknown, index: number): InboxEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.message !== 'string' || !data.message) return null;
  const entry: InboxEntry = {
    id: typeof data.id === 'string' && data.id ? data.id : `entry-${index}`,
    message: data.message,
    type: typeof data.type === 'string' ? data.type : 'info',
    at: typeof data.at === 'string' ? data.at : '',
  };
  if (typeof data.subject === 'string' && data.subject) {
    entry.subject = data.subject;
  }
  if (typeof data.error === 'string' && data.error) {
    entry.error = data.error;
  }
  if (typeof data.extensionId === 'string' && data.extensionId) {
    entry.extensionId = data.extensionId;
  }
  return entry;
}

export type RecentLoadResult =
  { ok: true; entries: InboxEntry[] } | { ok: false; error: string };

/**
 * Loads `GET /api/ext/notifications/recent` through the host-proxied fetch.
 * Never throws: every failure becomes `{ ok: false, error }` for the UI.
 */
export async function loadRecentNotifications(
  fetchRecent: RecentFetcher,
): Promise<RecentLoadResult> {
  try {
    const res = await fetchRecent(RECENT_PATH);
    if (!res.ok) {
      return {
        ok: false,
        error: `Could not load notifications (HTTP ${res.status}).`,
      };
    }
    const payload = JSON.parse(res.body) as { notifications?: unknown };
    if (!Array.isArray(payload.notifications)) {
      return { ok: false, error: 'Unexpected response from notifications.' };
    }
    const entries = payload.notifications
      .map((raw, index) => normalizeEntry(raw, index))
      .filter((entry): entry is InboxEntry => entry !== null);
    return { ok: true, entries: sortNewestFirst(entries) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not load notifications: ${reason}` };
  }
}
