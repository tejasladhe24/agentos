import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@agentos/ui/components/code-block';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@agentos/ui/components/sheet';

import { formatTime } from '../lib/parse-filters';
import { redactMeta } from '../lib/redact-meta';
import type { AuditEntry } from '../lib/types';

type ActivityDetailSheetProps = {
  entry: AuditEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ActivityDetailSheet({
  entry,
  open,
  onOpenChange,
}: ActivityDetailSheetProps) {
  const meta = redactMeta(entry?.meta);
  const metaJson = meta ? JSON.stringify(meta, null, 2) : 'null';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 sm:max-w-lg"
        data-slot="activity-detail-sheet"
      >
        <SheetHeader>
          <SheetTitle>{entry?.action ?? 'Entry'}</SheetTitle>
          <SheetDescription>
            {entry ? formatTime(entry.at) : 'Select a row to inspect meta.'}
          </SheetDescription>
        </SheetHeader>
        {entry ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Actor</dt>
              <dd>{entry.actor ?? '—'}</dd>
              <dt className="text-muted-foreground">Resource</dt>
              <dd className="break-all">{entry.resource ?? '—'}</dd>
              <dt className="text-muted-foreground">Org</dt>
              <dd className="font-mono text-xs">{entry.orgId ?? '—'}</dd>
              <dt className="text-muted-foreground">Id</dt>
              <dd className="font-mono text-xs break-all">{entry.id}</dd>
            </dl>
            <CodeBlock size="sm" className="min-h-0 flex-1">
              <CodeBlockHeader>
                <CodeBlockTitle>meta</CodeBlockTitle>
                <CodeBlockCopyButton value={metaJson} />
              </CodeBlockHeader>
              <CodeBlockContent wrap>{metaJson}</CodeBlockContent>
            </CodeBlock>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
