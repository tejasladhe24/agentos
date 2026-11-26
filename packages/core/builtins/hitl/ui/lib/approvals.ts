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
