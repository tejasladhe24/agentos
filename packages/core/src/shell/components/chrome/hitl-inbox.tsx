import { useCallback, useEffect, useState } from 'react';
import { useShellStore } from '@agentos/core/shell/lib';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { ScrollArea } from '@agentos/ui/components/scroll-area';

type Approval = {
  id: string;
  title: string;
  body?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};

async function fetchApprovals(): Promise<Approval[]> {
  const res = await fetch('/api/ext/hitl/approvals?status=pending', {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { approvals?: Approval[] };
  return body.approvals ?? [];
}

async function resolveApproval(
  id: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const res = await fetch(
    `/api/ext/hitl/approvals/${encodeURIComponent(id)}/resolve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ decision }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Resolve failed (${res.status})`);
  }
}

/** Left-sidebar HITL Approvals panel (no Sheet overlay). */
export function HitlInbox() {
  const open = useShellStore((s) => s.sidebarPanel === 'hitl');
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (isInitial = false) => {
    try {
      const next = await fetchApprovals();
      setApprovals(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setInitialLoading(true);
    void refresh(true);
    const timer = setInterval(() => {
      void refresh(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  async function onResolve(
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await resolveApproval(id, decision);
      await refresh(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-slot="hitl-inbox"
      data-loading={initialLoading ? 'true' : 'false'}
      aria-label="HITL inbox"
    >
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        Pending human-in-the-loop requests from agents and extensions.
      </p>
      <ScrollArea className="min-h-0 flex-1">
        {error ? (
          <p className="px-3 py-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {initialLoading ? (
          <LoadingState size="sm" data-slot="hitl-inbox-loading">
            Loading approvals…
          </LoadingState>
        ) : approvals.length === 0 ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">
            No pending approvals.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {approvals.map((approval) => (
              <li key={approval.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {approval.title}
                    </p>
                    {approval.body ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {approval.body}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant="secondary">pending</Badge>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === approval.id}
                    onClick={() => void onResolve(approval.id, 'approved')}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === approval.id}
                    onClick={() => void onResolve(approval.id, 'rejected')}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
