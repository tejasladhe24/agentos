import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@agentos/ui/components/alert';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { cn } from '@agentos/ui/lib/utils';
import {
  approvalSource,
  formatRelativeTime,
  formatTimestamp,
  type Approval,
  type ApprovalDecision,
} from '../lib/approvals';

export type ApprovalCardProps = {
  approval: Approval;
  busy: boolean;
  onResolve: (decision: ApprovalDecision) => void;
};

/**
 * One approval request as a shadcn `Alert`: title, message, and a quiet meta
 * line. Pending requests reveal Approve / Cancel in `AlertAction` on hover
 * (and on keyboard focus, or while a decision is in flight). Resolved requests
 * show their outcome as a badge.
 */
export function ApprovalCard({ approval, busy, onResolve }: ApprovalCardProps) {
  const pending = approval.status === 'pending';
  const source = approvalSource(approval);

  return (
    <li>
      <Alert
        data-approval-id={approval.id}
        data-status={approval.status}
        className={cn(
          'gap-1 py-3 transition-colors hover:bg-muted/30',
          pending
            ? 'has-data-[slot=alert-action]:pr-44'
            : 'has-data-[slot=alert-action]:pr-24',
        )}
      >
        <AlertTitle className="text-sm break-words">
          {approval.title}
        </AlertTitle>

        {approval.body ? (
          <AlertDescription className="text-sm whitespace-pre-wrap">
            {approval.body}
          </AlertDescription>
        ) : null}

        <AlertDescription className="text-xs text-muted-foreground/80">
          <time
            dateTime={approval.createdAt}
            title={formatTimestamp(approval.createdAt)}
          >
            Requested {formatRelativeTime(approval.createdAt)}
          </time>
          {source ? ` · via ${source}` : ''}
          {approval.resolvedAt ? (
            <>
              {' · '}
              <time
                dateTime={approval.resolvedAt}
                title={formatTimestamp(approval.resolvedAt)}
              >
                Resolved {formatRelativeTime(approval.resolvedAt)}
              </time>
            </>
          ) : null}
        </AlertDescription>

        <AlertAction className="top-2.5 right-2.5">
          {pending ? (
            <div
              data-slot="approval-actions"
              className={cn(
                'flex items-center gap-1.5 transition-opacity',
                busy
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/alert:opacity-100 group-focus-within/alert:opacity-100',
              )}
            >
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
                Cancel
              </Button>
            </div>
          ) : (
            <Badge
              variant={
                approval.status === 'approved' ? 'secondary' : 'destructive'
              }
            >
              {approval.status === 'approved' ? 'Approved' : 'Rejected'}
            </Badge>
          )}
        </AlertAction>
      </Alert>
    </li>
  );
}
