/**
 * @agentos/core/api/audit — HTTP client for builtin `audit` (ticket 82).
 */

import { getJson, postJson, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin audit API base (`…/api/ext/audit` or test override). */
export function resolveAuditApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('audit', 'AGENT_OS_AUDIT_API_BASE', env);
}

export type AuditEntryInput = {
  action: string;
  actor?: string;
  resource?: string;
  meta?: Record<string, unknown>;
};

export type AuditEntry = AuditEntryInput & {
  id: string;
  at: string;
};

export type ListEntriesResult = { entries: AuditEntry[] };

/** Append an audit entry (`POST /entries`). */
export async function appendEntry(
  input: AuditEntryInput,
  env?: EnvMap,
): Promise<AuditEntry> {
  const base = resolveAuditApiBase(env ?? Bun.env);
  return postJson<AuditEntry>(`${base}/entries`, input, 'audit appendEntry');
}

/** List recent audit entries (`GET /entries?limit=`). */
export async function listEntries(
  limit?: number,
  env?: EnvMap,
): Promise<AuditEntry[]> {
  const base = resolveAuditApiBase(env ?? Bun.env);
  const url =
    limit !== undefined
      ? `${base}/entries?limit=${encodeURIComponent(String(limit))}`
      : `${base}/entries`;
  const result = await getJson<ListEntriesResult>(url, 'audit listEntries');
  return result.entries;
}
