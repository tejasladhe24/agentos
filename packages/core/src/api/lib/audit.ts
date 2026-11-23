/**
 * @agentos/core/api/audit — HTTP client for builtin `audit` (tickets 82 / 97).
 */

import { jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin audit API base (`…/api/ext/audit` or test override). */
export function resolveAuditApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('audit', 'AGENT_OS_AUDIT_API_BASE', env);
}

/** Trusted peer / FDE header for active org (matches secrets + db-store). */
export const AUDIT_ORG_ID_HEADER = 'x-agentos-org-id';

export type AuditEntryInput = {
  action: string;
  actor?: string;
  resource?: string;
  meta?: Record<string, unknown>;
};

export type AuditEntry = AuditEntryInput & {
  id: string;
  at: string;
  orgId?: string;
};

export type AuditCallInit = {
  /** Forward cookie / auth headers from the inbound FDE request. */
  headers?: HeadersInit;
  /** Active org id sent as `X-AgentOS-Org-Id` (peer / service path). */
  orgId?: string;
};

export type ListEntriesOptions = {
  action?: string;
  actor?: string;
  resource?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
};

export type ListEntriesResult = {
  entries: AuditEntry[];
  nextCursor?: string;
};

function auditHeaders(init?: AuditCallInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.orgId) {
    headers.set(AUDIT_ORG_ID_HEADER, init.orgId);
  }
  return headers;
}

/** Append an audit entry (`POST /entries`). */
export async function appendEntry(
  input: AuditEntryInput,
  env?: EnvMap,
  init?: AuditCallInit,
): Promise<AuditEntry> {
  const base = resolveAuditApiBase(env ?? Bun.env);
  return jsonFetch<AuditEntry>(
    `${base}/entries`,
    {
      method: 'POST',
      body: input,
      headers: auditHeaders(init),
    },
    'audit appendEntry',
  );
}

/**
 * List audit entries (`GET /entries` with filters / opaque cursor).
 * Passing a number is treated as `{ limit }` for backward compatibility.
 */
export async function listEntries(
  options: ListEntriesOptions | number = {},
  env?: EnvMap,
  init?: AuditCallInit,
): Promise<ListEntriesResult> {
  const opts: ListEntriesOptions =
    typeof options === 'number' ? { limit: options } : options;
  const base = resolveAuditApiBase(env ?? Bun.env);
  const params = new URLSearchParams();
  if (opts.action) params.set('action', opts.action);
  if (opts.actor) params.set('actor', opts.actor);
  if (opts.resource) params.set('resource', opts.resource);
  if (opts.q) params.set('q', opts.q);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  const url = qs ? `${base}/entries?${qs}` : `${base}/entries`;
  return jsonFetch<ListEntriesResult>(
    url,
    { method: 'GET', headers: auditHeaders(init) },
    'audit listEntries',
  );
}
