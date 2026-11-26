/**
 * String-only search codec for the Shell router.
 *
 * TanStack Router's default codec JSON-parses values (`token=1e5` → number
 * `100000`) and rewrites the URL to match, which would corrupt opaque values
 * such as password-reset tokens. Every value here stays a string.
 */
export type SearchRecord = Record<string, string>;

/** Parse `?a=1&b=2` (leading `?` optional) into a string record. */
export function parseSearchString(search: string): SearchRecord {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const out: SearchRecord = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    out[key] = value;
  }
  return out;
}

/**
 * Serialize a record to `?a=1&b=2`. `undefined`, `null`, and empty values are
 * dropped; returns `''` when nothing remains.
 */
export function stringifySearchRecord(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}
