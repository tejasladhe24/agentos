import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@agentos/ui/components/input-group';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@agentos/ui/components/tabs';
import { ApprovalCard } from './components/approval-card';
import {
  APPROVAL_FILTERS,
  filterApprovals,
  type ApprovalFilter,
} from './lib/approvals';
import { useApprovals } from './lib/use-approvals';

/**
 * Approvals (HITL) — full page at `/ext/hitl`. Scrollable list of shadcn cards
 * with status tabs, fuzzy search, and hover Approve / Cancel actions.
 */
export default function ApprovalsPage() {
  const [filter, setFilter] = useState<ApprovalFilter>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const { approvals, loading, error, busyId, resolve } = useApprovals(filter);

  const visibleApprovals = useMemo(
    () => filterApprovals(approvals, searchQuery),
    [approvals, searchQuery],
  );

  const filterLabel =
    APPROVAL_FILTERS.find((f) => f.value === filter)?.label ?? filter;
  const hasSearch = searchQuery.trim().length > 0;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
      data-slot="approvals-page"
    >
      <div className="mx-auto flex h-full min-h-0 w-full max-w-screen-md flex-col gap-4 p-6">
        <header className="shrink-0">
          <h1 className="text-lg font-semibold text-foreground">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Human-in-the-loop requests from agents and extensions. Hover a
            pending card to approve or cancel it.
          </p>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <InputGroup className="min-w-48 flex-1">
            <InputGroupInput
              placeholder="Search approvals…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search approvals"
            />
            <InputGroupAddon>
              <MagnifyingGlassIcon
                className="size-4 shrink-0 opacity-50"
                aria-hidden
              />
            </InputGroupAddon>
          </InputGroup>

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
        </div>

        {error ? (
          <Alert variant="destructive" className="shrink-0">
            <AlertTitle>Could not load approvals</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <LoadingState size="sm">Loading approvals…</LoadingState>
          ) : visibleApprovals.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {hasSearch
                    ? 'No matching approvals'
                    : `No ${filterLabel.toLowerCase()} approvals`}
                </EmptyTitle>
                <EmptyDescription>
                  {hasSearch
                    ? 'Try a different search term or status filter.'
                    : filter === 'pending'
                      ? 'Nothing is waiting on you. New requests appear here automatically.'
                      : 'Nothing matches this status yet.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3 pr-3" aria-label="Approvals">
              {visibleApprovals.map((approval) => (
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
    </div>
  );
}
