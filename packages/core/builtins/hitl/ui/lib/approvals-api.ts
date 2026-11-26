import type { HostAPIClient } from '@agentos/core/sdk';
import {
  approvalsPath,
  errorMessage,
  parseApprovals,
  resolvePath,
  sortNewestFirst,
  type Approval,
  type ApprovalDecision,
  type ApprovalFilter,
} from './approvals';

/** The host `api.fetch` (proxied to `/api/ext/hitl/*`). */
export type ApprovalsFetch = HostAPIClient['api']['fetch'];

/** Load approvals for a status tab, newest first. Throws on a failed response. */
export async function fetchApprovals(
  fetch: ApprovalsFetch,
  filter: ApprovalFilter,
): Promise<Approval[]> {
  const res = await fetch(approvalsPath(filter), { method: 'GET' });
  if (!res.ok) {
    throw new Error(errorMessage(res.status, res.body));
  }
  return sortNewestFirst(parseApprovals(res.body));
}

/** Approve or reject a pending request. The API answers 409 if it is already resolved. */
export async function resolveApproval(
  fetch: ApprovalsFetch,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  const res = await fetch(resolvePath(approvalId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) {
    throw new Error(errorMessage(res.status, res.body));
  }
}
