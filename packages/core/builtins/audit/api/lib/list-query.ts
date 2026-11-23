import {
  DEFAULT_LIST_LIMIT,
  IN_PROCESS_SCAN_BATCH,
  MAX_LIST_LIMIT,
} from './constants';
import type { AuditEntry, DbStoreClient, QueryInput } from './db-store-client';

export type ListFilters = {
  /** Exact action, or prefix when ending with `*`. */
  action?: string;
  actor?: string;
  resource?: string;
  q?: string;
  from?: string;
  to?: string;
  limit: number;
  /** Opaque base64url offset into the db-store scan. */
  cursor?: string;
};

export type ListEntriesPage = {
  entries: AuditEntry[];
  nextCursor?: string;
};

export function parseListFilters(url: URL): ListFilters | { error: string } {
  const limitRaw = url.searchParams.get('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (limitRaw !== null && limitRaw !== '') {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 1) {
      return { error: 'limit must be a positive number' };
    }
    limit = Math.min(MAX_LIST_LIMIT, Math.floor(n));
  }

  const action = trimParam(url.searchParams.get('action'));
  const actor = trimParam(url.searchParams.get('actor'));
  const resource = trimParam(url.searchParams.get('resource'));
  const q = trimParam(url.searchParams.get('q'));
  const from = trimParam(url.searchParams.get('from'));
  const to = trimParam(url.searchParams.get('to'));
  const cursor = trimParam(url.searchParams.get('cursor')) ?? undefined;

  return {
    action,
    actor,
    resource,
    q,
    from,
    to,
    limit,
    cursor,
  };
}

function trimParam(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export function decodeCursor(
  cursor: string | undefined,
): number | { error: string } {
  if (!cursor) return 0;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return { error: 'invalid cursor' };
    }
    return n;
  } catch {
    return { error: 'invalid cursor' };
  }
}

function actionPrefix(action: string | undefined): string | undefined {
  if (!action || !action.endsWith('*')) return undefined;
  return action.slice(0, -1);
}

function needsInProcessFilter(filters: ListFilters): boolean {
  return Boolean(filters.q || actionPrefix(filters.action));
}

export function buildWhere(
  filters: ListFilters,
  orgId: string,
): Record<string, unknown> {
  const where: Record<string, unknown> = { orgId };

  const prefix = actionPrefix(filters.action);
  if (filters.action && !prefix) {
    where.action = filters.action;
  }
  if (filters.actor) where.actor = filters.actor;
  if (filters.resource) where.resource = filters.resource;

  if (filters.from || filters.to) {
    const at: Record<string, string> = {};
    if (filters.from) at.$gte = filters.from;
    if (filters.to) at.$lte = filters.to;
    where.at = at;
  }

  return where;
}

function matchesInProcess(entry: AuditEntry, filters: ListFilters): boolean {
  const prefix = actionPrefix(filters.action);
  if (prefix !== undefined && !entry.action.startsWith(prefix)) {
    return false;
  }
  if (!filters.q) return true;
  const needle = filters.q.toLowerCase();
  const haystacks = [
    entry.action,
    entry.actor ?? '',
    entry.resource ?? '',
    entry.meta ? JSON.stringify(entry.meta) : '',
  ];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

/**
 * List audit entries with org filter, optional structured where, and
 * in-process q / action-prefix. Cursor is an opaque db-store scan offset.
 */
export async function listEntriesPage(
  db: DbStoreClient,
  filters: ListFilters,
  orgId: string,
): Promise<ListEntriesPage | { error: string }> {
  const offsetOrError = decodeCursor(filters.cursor);
  if (typeof offsetOrError === 'object') return offsetOrError;
  let scanned = offsetOrError;

  const where = buildWhere(filters, orgId);
  const baseQuery: QueryInput = {
    where,
    sort: { at: 'desc' },
  };

  if (!needsInProcessFilter(filters)) {
    const rows = await db.query({
      ...baseQuery,
      limit: filters.limit + 1,
      offset: scanned,
    });
    const hasMore = rows.length > filters.limit;
    const entries = hasMore ? rows.slice(0, filters.limit) : rows;
    return {
      entries,
      nextCursor: hasMore ? encodeCursor(scanned + filters.limit) : undefined,
    };
  }

  const page: AuditEntry[] = [];
  let exhausted = false;

  while (page.length < filters.limit) {
    const batch = await db.query({
      ...baseQuery,
      limit: IN_PROCESS_SCAN_BATCH,
      offset: scanned,
    });
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    for (const entry of batch) {
      scanned += 1;
      if (matchesInProcess(entry, filters)) {
        page.push(entry);
        if (page.length === filters.limit) break;
      }
    }
    if (batch.length < IN_PROCESS_SCAN_BATCH) {
      exhausted = true;
      break;
    }
    if (page.length === filters.limit) break;
  }

  if (page.length < filters.limit) {
    return { entries: page };
  }

  if (!exhausted) {
    return { entries: page, nextCursor: encodeCursor(scanned) };
  }

  // Filled the page exactly at end of a short final batch — peek ahead.
  const peek = await db.query({
    ...baseQuery,
    limit: IN_PROCESS_SCAN_BATCH,
    offset: scanned,
  });
  const hasMore = peek.some((e) => matchesInProcess(e, filters));
  return {
    entries: page,
    nextCursor: hasMore ? encodeCursor(scanned) : undefined,
  };
}
