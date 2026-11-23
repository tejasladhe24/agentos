import { EMPTY_FILTERS, type ActivityFilters } from './types';

export function parseFiltersFromSearch(
  search: string,
): Partial<ActivityFilters> {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const out: Partial<ActivityFilters> = {};
  for (const key of [
    'action',
    'actor',
    'resource',
    'q',
    'from',
    'to',
  ] as const) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

export function parseFiltersFromStorage(
  raw: unknown,
): Partial<ActivityFilters> {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const obj = parsed as Record<string, unknown>;
  const out: Partial<ActivityFilters> = {};
  for (const key of Object.keys(EMPTY_FILTERS) as Array<
    keyof ActivityFilters
  >) {
    if (typeof obj[key] === 'string' && obj[key].trim()) {
      out[key] = obj[key].trim();
    }
  }
  return out;
}

export function filtersToQuery(filters: ActivityFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters) as Array<
    [keyof ActivityFilters, string]
  >) {
    const trimmed = value.trim();
    if (trimmed) params.set(key, trimmed);
  }
  return params;
}

export function hasActiveFilters(filters: ActivityFilters): boolean {
  return Object.values(filters).some((v) => v.trim().length > 0);
}

export function metaSummary(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '—';
  try {
    const json = JSON.stringify(meta);
    if (json.length <= 80) return json;
    return `${json.slice(0, 77)}…`;
  } catch {
    return '—';
  }
}

export function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
