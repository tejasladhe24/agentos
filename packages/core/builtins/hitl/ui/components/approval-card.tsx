import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import {
  formatMetadata,
  formatTimestamp,
  type Approval,
  type ApprovalDecision,
} from '../lib/approvals';

const STATUS_VARIANT = {
  pending: 'outline',
  approved: 'secondary',
  rejected: 'destructive',
} as const;

export type ApprovalCardProps = {
  approval: Approval;
  busy: boolean;
  onResolve: (decision: ApprovalDecision) => void;
};

/** One approval request: full body, metadata, timestamps, and decision buttons when pending. */
export function ApprovalCard({ approval, busy, onResolve }: ApprovalCardProps) {
  const pending = approval.status === 'pending';
  const hasMetadata =
    approval.metadata !== undefined &&
    Object.keys(approval.metadata).length > 0;

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      data-approval-id={approval.id}
      data-status={approval.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            {approval.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            Requested {formatTimestamp(approval.createdAt)}
            {approval.resolvedAt
              ? ` · Resolved ${formatTimestamp(approval.resolvedAt)}`
              : ''}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[approval.status]}>
          {approval.status}
        </Badge>
      </div>

      {approval.body ? (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {approval.body}
        </p>
      ) : null}

      {hasMetadata ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Metadata</p>
          <pre
            className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground"
            data-slot="approval-metadata"
          >
            {formatMetadata(approval.metadata ?? {})}
          </pre>
        </div>
      ) : null}

      {pending ? (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onResolve('approved')}
          >
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve('rejected')}
          >
            Reject
          </Button>
        </div>
      ) : null}
    </li>
  );
}
