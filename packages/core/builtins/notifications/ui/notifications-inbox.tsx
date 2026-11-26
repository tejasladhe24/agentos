import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
  type Icon,
} from '@phosphor-icons/react';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import { cn } from '@agentos/ui/lib/utils';

import {
  filterEntries,
  formatAbsoluteTime,
  formatRelativeTime,
  INBOX_FILTERS,
  SEVERITY_LABEL,
  severityOf,
  type InboxEntry,
  type InboxFilter,
  type InboxSeverity,
  type InboxState,
} from './inbox-model';

const SEVERITY_ICON: Record<InboxSeverity, Icon> = {
  error: XCircleIcon,
  warning: WarningIcon,
  success: CheckCircleIcon,
  info: InfoIcon,
};

const SEVERITY_ICON_CLASS: Record<InboxSeverity, string> = {
  error: 'text-destructive',
  // No warning/success token in @agentos/ui yet; keep the palette in one place.
  warning: 'text-amber-600 dark:text-amber-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  info: 'text-muted-foreground',
};

const SEVERITY_BADGE_VARIANT: Record<
  InboxSeverity,
  'destructive' | 'outline' | 'secondary' | 'ghost'
> = {
  error: 'destructive',
  warning: 'outline',
  success: 'secondary',
  info: 'ghost',
};

export type NotificationsInboxProps = {
  state: InboxState;
  filter: InboxFilter;
  /** Reference time for relative timestamps (passed in so tests are stable). */
  now: number;
  onFilterChange: (filter: InboxFilter) => void;
  onRefresh: () => void;
};

/**
 * Presentational inbox list for the Notifications right sheet. The container
 * (`right-sheet.tsx`) owns fetching, polling, and state.
 */
export function NotificationsInbox({
  state,
  filter,
  now,
  onFilterChange,
  onRefresh,
}: NotificationsInboxProps) {
  const visible = filterEntries(state.entries, filter);
  const filterMeta = INBOX_FILTERS.find((f) => f.id === filter);
  const isLoading = state.status === 'loading';
  const showFullError = state.status === 'error' && state.entries.length === 0;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 text-foreground"
      data-slot="notifications-inbox"
      data-status={state.status}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {INBOX_FILTERS.map((option) => {
          const active = option.id === filter;
          return (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={active ? 'secondary' : 'ghost'}
              aria-pressed={active}
              data-slot="notifications-filter"
              data-filter={option.id}
              onClick={() => onFilterChange(option.id)}
            >
              {option.label}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Refresh notifications"
          data-slot="notifications-refresh"
          disabled={isLoading}
          onClick={onRefresh}
        >
          <ArrowClockwiseIcon
            className={cn(isLoading && 'animate-spin')}
            aria-hidden="true"
          />
        </Button>
      </div>

      {state.status === 'error' && state.entries.length > 0 ? (
        <ErrorBanner message={state.error} onRetry={onRefresh} />
      ) : null}

      {isLoading && state.entries.length === 0 ? (
        <LoadingState size="sm">Loading notifications…</LoadingState>
      ) : showFullError ? (
        <ErrorBanner message={state.error} onRetry={onRefresh} />
      ) : visible.length === 0 ? (
        <p
          className="py-6 text-center text-xs text-muted-foreground"
          data-slot="notifications-empty"
        >
          {state.entries.length === 0
            ? 'No notifications yet'
            : (filterMeta?.emptyText ?? 'No notifications')}
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul
            className="flex flex-col gap-2 pr-2"
            data-slot="notifications-list"
          >
            {visible.map((entry) => (
              <NotificationRow key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string | undefined;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      data-slot="notifications-error"
      className="flex items-center justify-between gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      <span>{message ?? 'Could not load notifications.'}</span>
      <Button type="button" size="xs" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function NotificationRow({ entry, now }: { entry: InboxEntry; now: number }) {
  const severity = severityOf(entry.type);
  const Icon = SEVERITY_ICON[severity];
  return (
    <li
      className="flex gap-2.5 border border-border bg-card px-3 py-2.5"
      data-slot="notification-row"
      data-severity={severity}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', SEVERITY_ICON_CLASS[severity])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={SEVERITY_BADGE_VARIANT[severity]}
            data-slot="notification-severity"
          >
            {SEVERITY_LABEL[severity]}
          </Badge>
          {entry.extensionId ? (
            <Badge variant="outline" data-slot="notification-source">
              {entry.extensionId}
            </Badge>
          ) : null}
          {entry.at ? (
            <time
              dateTime={entry.at}
              title={formatAbsoluteTime(entry.at)}
              className="ml-auto text-[11px] text-muted-foreground"
            >
              {formatRelativeTime(entry.at, now)}
            </time>
          ) : null}
        </div>
        {entry.subject ? (
          <p className="text-xs font-medium text-foreground">{entry.subject}</p>
        ) : null}
        <p className="break-words text-xs text-foreground">{entry.message}</p>
        {entry.error ? (
          <p className="break-words text-[11px] text-muted-foreground">
            {entry.error}
          </p>
        ) : null}
      </div>
    </li>
  );
}
