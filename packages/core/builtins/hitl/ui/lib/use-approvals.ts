import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useHostApi,
  useHostEvent,
  useHostNotifications,
} from '@agentos/core/client';
import type { Approval, ApprovalDecision, ApprovalFilter } from './approvals';
import { fetchApprovals, resolveApproval } from './approvals-api';

import { startFallbackRefresh } from './approvals-refresh';

export type UseApprovalsResult = {
  approvals: Approval[];
  loading: boolean;
  error: string | null;
  /** Id of the approval currently being resolved, if any. */
  busyId: string | null;
  resolve: (approval: Approval, decision: ApprovalDecision) => Promise<void>;
};

/**
 * Loads approvals for a status filter, refreshes on `hitl.*` bus events (plus a
 * slow visible-only fallback poll), and resolves
 * pending requests. The HITL API owns all state; this hook only mirrors it.
 */
export function useApprovals(filter: ApprovalFilter): UseApprovalsResult {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const apiRef = useRef(api);
  apiRef.current = api;
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Latest request wins so a slow response cannot overwrite a newer filter. */
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const next = await fetchApprovals(
        (path, init) => apiRef.current.fetch(path, init),
        filter,
      );
      if (seq !== requestSeq.current) return;
      setApprovals(next);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filter]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setLoading(true);
    void load();
    return startFallbackRefresh(() => void load());
  }, [load]);

  useHostEvent('hitl.requested', () => void loadRef.current());
  useHostEvent('hitl.resolved', () => void loadRef.current());

  const resolve = useCallback(
    async (approval: Approval, decision: ApprovalDecision) => {
      setBusyId(approval.id);
      try {
        await resolveApproval(
          (path, init) => apiRef.current.fetch(path, init),
          approval.id,
          decision,
        );
        void notificationsRef.current.show(
          `${decision === 'approved' ? 'Approved' : 'Cancelled'}: ${approval.title}`,
          decision === 'approved' ? 'success' : 'info',
        );
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        void notificationsRef.current.show(
          `Could not resolve approval: ${message}`,
          'error',
        );
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return { approvals, loading, error, busyId, resolve };
}
