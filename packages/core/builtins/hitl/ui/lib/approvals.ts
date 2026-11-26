export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Status tab on the Approvals page. `all` omits the `?status=` filter. */
export type ApprovalFilter = ApprovalStatus | 'all';

export type Approval = {
  id: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
};

export type ApprovalDecision = Exclude<ApprovalStatus, 'pending'>;

export const APPROVAL_FILTERS: ReadonlyArray<{
  value: ApprovalFilter;
  label: string;
}> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

/** Relative to the extension API root (`/api/ext/hitl`). */
export function approvalsPath(filter: ApprovalFilter): string {
  if (filter === 'all') return '/approvals';
  return `/approvals?status=${encodeURIComponent(filter)}`;
}

export function resolvePath(id: string): string {
  return `/approvals/${encodeURIComponent(id)}/resolve`;
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected';
}

/** Parse the list response, dropping rows that do not match the Approval shape. */
export function parseApprovals(body: string): Approval[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const rows =
    parsed && typeof parsed === 'object' && 'approvals' in parsed
      ? (parsed as { approvals: unknown }).approvals
      : null;
  if (!Array.isArray(rows)) return [];
  const out: Approval[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.title !== 'string') continue;
    if (!isApprovalStatus(r.status)) continue;
    const approval: Approval = {
      id: r.id,
      title: r.title,
      status: r.status,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    };
    if (typeof r.body === 'string') approval.body = r.body;
    if (
      r.metadata &&
      typeof r.metadata === 'object' &&
      !Array.isArray(r.metadata)
    ) {
      approval.metadata = r.metadata as Record<string, unknown>;
    }
    if (typeof r.resolvedAt === 'string') approval.resolvedAt = r.resolvedAt;
    out.push(approval);
  }
  return out;
}

/** Newest first by request time (ISO strings sort lexically). */
export function sortNewestFirst(approvals: Approval[]): Approval[] {
  return [...approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Case-insensitive fuzzy subsequence match across whitespace-separated tokens.
 * Every token in `query` must match as an ordered subsequence in `haystack`.
 */
export function fuzzyMatch(query: string, haystack: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const target = haystack.toLowerCase();
  return tokens.every((token) => {
    let pos = 0;
    for (let i = 0; i < token.length; i += 1) {
      const found = target.indexOf(token[i]!, pos);
      if (found === -1) return false;
      pos = found + 1;
    }
    return true;
  });
}

function approvalSearchText(approval: Approval): string {
  const parts = [approval.title];
  if (approval.body) parts.push(approval.body);
  if (approval.metadata) parts.push(JSON.stringify(approval.metadata));
  return parts.join(' ');
}

/** Fuzzy-filter approvals by title, body, and metadata content. */
export function filterApprovals(
  approvals: ReadonlyArray<Approval>,
  query: string,
): Approval[] {
  if (!query.trim()) return [...approvals];
  return approvals.filter((item) =>
    fuzzyMatch(query, approvalSearchText(item)),
  );
}

/** Human message for a failed response (`{ error, detail }` or plain text). */
export function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string; detail?: string };
    if (parsed.error) {
      return parsed.detail ? `${parsed.error}: ${parsed.detail}` : parsed.error;
    }
  } catch {
    // Not JSON — fall through to the status line.
  }
  return body.trim() || `Request failed (${status})`;
}

export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function formatMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2);
}

/** "5 minutes ago" / "yesterday"; falls back to a short date after 30 days. */
export function formatRelativeTime(
  iso: string | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.round((ts - now) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 30 * 86_400) return rtf.format(Math.round(diffSec / 86_400), 'day');
  return new Date(ts).toLocaleDateString();
}

/** What raised the request, when the caller set `metadata.source` (extension, service, or agent name). */
export function approvalSource(approval: Approval): string | undefined {
  const source = approval.metadata?.source;
  return typeof source === 'string' && source.trim()
    ? source.trim()
    : undefined;
}
