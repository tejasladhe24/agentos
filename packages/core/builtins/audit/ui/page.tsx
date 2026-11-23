import { useEffect, useRef, useState } from 'react';
import {
  useHostApi,
  useHostNotifications,
  useHostStorage,
} from '@agentos/core/client';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@agentos/ui/components/alert';
import { Button } from '@agentos/ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@agentos/ui/components/empty';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { Separator } from '@agentos/ui/components/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@agentos/ui/components/dropdown-menu';

import { ActivityDetailSheet } from './components/activity-detail-sheet';
import { ActivityFiltersBar } from './components/activity-filters';
import { ActivityTable } from './components/activity-table';
import { exportEntriesCsv, exportEntriesJson } from './lib/export-entries';
import {
  filtersToQuery,
  hasActiveFilters,
  parseFiltersFromSearch,
  parseFiltersFromStorage,
} from './lib/parse-filters';
import {
  ACTIVITY_FILTERS_STORAGE_KEY,
  EMPTY_FILTERS,
  MAX_EXPORT_ROWS,
  type ActivityFilters,
  type AuditEntry,
} from './lib/types';

type AutoRefreshSeconds = 0 | 15 | 60;

function toIsoOrRaw(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // datetime-local → treat as local wall time
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed) &&
    !trimmed.endsWith('Z')
  ) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return trimmed;
}

function buildEntriesQuery(
  filters: ActivityFilters,
  opts: { limit?: number; cursor?: string } = {},
): string {
  const params = filtersToQuery({
    ...filters,
    from: toIsoOrRaw(filters.from),
    to: toIsoOrRaw(filters.to),
  });
  params.set('limit', String(opts.limit ?? 50));
  if (opts.cursor) params.set('cursor', opts.cursor);
  return `/entries?${params.toString()}`;
}

/**
 * Activity manager — searchable, filterable audit timeline for the active org.
 * Builtin id remains `audit`; chrome label is Activity.
 */
export default function ActivityPage() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const storage = useHostStorage();

  const [draft, setDraft] = useState<ActivityFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<ActivityFilters>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState<AutoRefreshSeconds>(0);
  const [booted, setBooted] = useState(false);
  const appliedRef = useRef(applied);
  appliedRef.current = applied;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromUrl = parseFiltersFromSearch(
        typeof location !== 'undefined' ? location.search : '',
      );
      const storedRaw = await storage.get(ACTIVITY_FILTERS_STORAGE_KEY);
      const fromStorage = parseFiltersFromStorage(storedRaw);
      const initial = { ...EMPTY_FILTERS, ...fromStorage, ...fromUrl };
      if (cancelled) return;
      setDraft(initial);
      setApplied(initial);
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  async function loadPage(
    mode: 'replace' | 'append',
    filters: ActivityFilters,
  ) {
    const isAppend = mode === 'append';
    if (isAppend) setLoadingMore(true);
    else setBusy(true);
    setError(null);
    try {
      const path = buildEntriesQuery(filters, {
        limit: 50,
        cursor: isAppend ? nextCursor : undefined,
      });
      const res = await api.fetch(path, { method: 'GET' });
      if (!res.ok) {
        let message = `Failed to load activity (${res.status})`;
        try {
          const body = JSON.parse(res.body) as {
            error?: string;
            detail?: string;
          };
          if (body.error === 'db-store unavailable' || res.status === 502) {
            message = 'Activity store unavailable (502). Try again shortly.';
          } else if (body.error) {
            message = body.error;
          }
        } catch {
          /* ignore */
        }
        setError(message);
        if (!isAppend) setEntries([]);
        return;
      }
      const body = JSON.parse(res.body) as {
        entries?: AuditEntry[];
        nextCursor?: string;
      };
      const page = Array.isArray(body.entries) ? body.entries : [];
      setEntries((prev) => (isAppend ? [...prev, ...page] : page));
      setNextCursor(body.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (!isAppend) setEntries([]);
    } finally {
      setBusy(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!booted) return;
    void loadPage('replace', applied);
  }, [booted, applied]);

  useEffect(() => {
    if (!autoRefresh || !booted) return;
    const id = window.setInterval(() => {
      void loadPage('replace', appliedRef.current);
    }, autoRefresh * 1000);
    return () => window.clearInterval(id);
  }, [autoRefresh, booted]);

  async function applyFilters(next: ActivityFilters) {
    setApplied(next);
    setDraft(next);
    await storage.set(ACTIVITY_FILTERS_STORAGE_KEY, { ...next });
  }

  async function clearFilters() {
    await applyFilters(EMPTY_FILTERS);
  }

  async function exportAll(format: 'json' | 'csv') {
    setBusy(true);
    setError(null);
    try {
      const collected: AuditEntry[] = [];
      let cursor: string | undefined;
      while (collected.length < MAX_EXPORT_ROWS) {
        const remaining = MAX_EXPORT_ROWS - collected.length;
        const limit = Math.min(100, remaining);
        const path = buildEntriesQuery(applied, { limit, cursor });
        const res = await api.fetch(path, { method: 'GET' });
        if (!res.ok) {
          throw new Error(`Export failed (${res.status})`);
        }
        const body = JSON.parse(res.body) as {
          entries?: AuditEntry[];
          nextCursor?: string;
        };
        const page = Array.isArray(body.entries) ? body.entries : [];
        collected.push(...page);
        if (!body.nextCursor || page.length === 0) break;
        cursor = body.nextCursor;
      }
      if (format === 'json') exportEntriesJson(collected);
      else exportEntriesCsv(collected);
      await notifications.show(
        `Downloaded ${collected.length} entr${collected.length === 1 ? 'y' : 'ies'}.`,
        'success',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      await notifications.show(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const showLoading = busy && entries.length === 0 && !error;
  const showEmpty = !busy && !error && entries.length === 0 && booted;

  return (
    <div
      className="flex h-full min-h-full flex-col gap-4 bg-background p-6 text-foreground"
      data-slot="activity-page"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Who did what in this organization. Append-only audit log — not the
            events outbox.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void loadPage('replace', applied)}
          >
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" disabled={busy} />
              }
            >
              Auto-refresh: {autoRefresh === 0 ? 'Off' : `${autoRefresh}s`}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAutoRefresh(0)}>
                Off
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAutoRefresh(15)}>
                Every 15s
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAutoRefresh(60)}>
                Every 60s
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" disabled={busy} />
              }
            >
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void exportAll('json')}>
                Download JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportAll('csv')}>
                Download CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Separator />

      <ActivityFiltersBar
        filters={draft}
        disabled={busy}
        onChange={setDraft}
        onApply={() => void applyFilters(draft)}
        onClear={() => void clearFilters()}
      />

      {hasActiveFilters(applied) ? (
        <p className="text-xs text-muted-foreground">
          Showing filtered results. Clear filters to restore the recent feed.
        </p>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load activity</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {showLoading ? <LoadingState>Loading activity…</LoadingState> : null}

      {showEmpty ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No activity yet</EmptyTitle>
            <EmptyDescription>
              Entries appear when services append audits (for example subject
              delete). Try clearing filters if you expected results.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {entries.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-none border">
          <ActivityTable
            entries={entries}
            selectedId={selected?.id}
            onSelect={(entry) => {
              setSelected(entry);
              setSheetOpen(true);
            }}
          />
        </div>
      ) : null}

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={busy || loadingMore}
            onClick={() => void loadPage('append', applied)}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      <ActivityDetailSheet
        entry={selected}
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
