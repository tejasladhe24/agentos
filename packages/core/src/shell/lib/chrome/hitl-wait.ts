import type { HitlApprovalResult } from '@agentos/core/sdk';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type WaitForApprovalDeps = {
  /** Single-record lookup (`GET /api/ext/hitl/approvals/:id`). */
  fetchStatus: (id: string) => Promise<ApprovalStatus | null>;
  /**
   * Subscribe to `hitl.resolved`; `onResolved` gets the decision for any
   * approval. Returns an unsubscribe function.
   */
  listenResolved: (
    onResolved: (event: { approvalId: string; decision: string }) => void,
  ) => () => void;
  /** Slow safety-net poll (events may be unavailable or org-unscoped). */
  pollMs?: number;
  timeoutMs?: number;
};

export const HITL_FALLBACK_POLL_MS = 5_000;
export const HITL_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

function toResult(
  id: string,
  decision: string | null,
): HitlApprovalResult | null {
  if (decision === 'approved') return { approved: true, id };
  if (decision === 'rejected') return { approved: false, id };
  return null;
}

/**
 * Resolves when approval `id` is decided. Event-driven (`hitl.resolved`) with
 * one immediate check (the decision may land before the listener attaches)
 * and a slow single-record poll as a fallback. Never lists approvals.
 */
export function waitForApproval(
  id: string,
  deps: WaitForApprovalDeps,
): Promise<HitlApprovalResult> {
  const pollMs = deps.pollMs ?? HITL_FALLBACK_POLL_MS;
  const timeoutMs = deps.timeoutMs ?? HITL_WAIT_TIMEOUT_MS;

  return new Promise<HitlApprovalResult>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      unlisten?.();
      if (pollTimer) clearTimeout(pollTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      done();
    };

    const check = async () => {
      if (settled) return;
      try {
        const result = toResult(id, await deps.fetchStatus(id));
        if (result) finish(() => resolve(result));
      } catch {
        // Transient failure: the next poll or event retries.
      }
    };

    const schedulePoll = () => {
      if (settled) return;
      pollTimer = setTimeout(() => {
        void check().finally(schedulePoll);
      }, pollMs);
    };

    unlisten = deps.listenResolved((event) => {
      if (event.approvalId !== id) return;
      const result = toResult(id, event.decision);
      if (result) finish(() => resolve(result));
      else void check();
    });
    deadlineTimer = setTimeout(
      () =>
        finish(() => reject(new Error(`HITL approval timed out for ${id}`))),
      timeoutMs,
    );

    void check();
    schedulePoll();
  });
}
