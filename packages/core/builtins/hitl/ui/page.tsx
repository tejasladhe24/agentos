import { useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@agentos/ui/components/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@agentos/ui/components/empty';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@agentos/ui/components/tabs';
import { ApprovalCard } from './components/approval-card';
import { APPROVAL_FILTERS, type ApprovalFilter } from './lib/approvals';
import { useApprovals } from './lib/use-approvals';

/**
 * Approvals (HITL) — full page at `/ext/hitl`. Agents and extensions block on
 * a request until someone approves or rejects it here.
 */
export default function ApprovalsPage() {
  const [filter, setFilter] = useState<ApprovalFilter>('pending');
  const { approvals, loading, error, busyId, resolve } = useApprovals(filter);
  const filterLabel =
    APPROVAL_FILTERS.find((f) => f.value === filter)?.label ?? filter;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden bg-background p-6"
      data-slot="approvals-page"
    >
      <header className="shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Human-in-the-loop requests from agents and extensions. Approve or
          reject a pending request to let the waiting work continue.
        </p>
      </header>

      <Tabs
        value={filter}
        onValueChange={(value) => setFilter(value as ApprovalFilter)}
        className="shrink-0"
      >
        <TabsList aria-label="Filter approvals by status">
          {APPROVAL_FILTERS.map((option) => (
            <TabsTrigger
              key={option.value}
              value={option.value}
              data-slot="approvals-filter"
              data-value={option.value}
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <Alert variant="destructive" className="shrink-0">
          <AlertTitle>Could not load approvals</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <LoadingState size="sm">Loading approvals…</LoadingState>
        ) : approvals.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No {filterLabel.toLowerCase()} approvals</EmptyTitle>
              <EmptyDescription>
                {filter === 'pending'
                  ? 'Nothing is waiting on you. New requests appear here automatically.'
                  : 'Nothing matches this status yet.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3 pr-3" aria-label="Approvals">
            {approvals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                busy={busyId === approval.id}
                onResolve={(decision) => void resolve(approval, decision)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
