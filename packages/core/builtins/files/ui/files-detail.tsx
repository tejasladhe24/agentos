import { XIcon } from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { Separator } from '@agentos/ui/components/separator';
import { Badge } from '@agentos/ui/components/badge';
import { ScrollArea } from '@agentos/ui/components/scroll-area';

import { FilesPreview } from './files-preview';
import {
  formatBytes,
  formatDate,
  type FilesBlobJson,
  type FilesListItem,
} from './files-types';

export type FilesDetailProps = {
  open: boolean;
  selection: FilesListItem[];
  primary: FilesListItem | null;
  blob: FilesBlobJson | null;
  blobUrl: string | null;
  previewLoading: boolean;
  previewError: string | null;
  onDownload: (item: FilesListItem) => void;
  onClose: () => void;
};

export function FilesDetail({
  open,
  selection,
  primary,
  blob,
  blobUrl,
  previewLoading,
  previewError,
  onDownload,
  onClose,
}: FilesDetailProps) {
  if (!open) return null;

  return (
    <aside
      data-slot="files-detail"
      className="flex h-full min-h-0 w-full flex-col border-border bg-background"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight">
            {selection.length === 0
              ? 'Details'
              : selection.length === 1
                ? (primary?.name ?? 'Selected')
                : `${selection.length} selected`}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selection.length === 0
              ? 'Select a file to preview metadata.'
              : selection.length === 1
                ? (primary?.contentType ?? primary?.kind ?? '')
                : 'Multiple items'}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close details"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-4">
          {selection.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Choose a row to see preview and file info.
            </p>
          ) : null}

          {selection.length > 1 ? (
            <ul className="flex flex-col gap-1.5 text-xs">
              {selection.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5"
                >
                  <span className="truncate">{item.name}</span>
                  <Badge variant="outline">{item.kind}</Badge>
                </li>
              ))}
            </ul>
          ) : null}

          {primary && selection.length === 1 ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Kind</dt>
                <dd>
                  <Badge variant="secondary">{primary.kind}</Badge>
                </dd>
                <dt className="text-muted-foreground">Size</dt>
                <dd>{formatBytes(primary.bytes)}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="truncate">{primary.contentType ?? '—'}</dd>
                <dt className="text-muted-foreground">Modified</dt>
                <dd>{formatDate(primary.updatedAt)}</dd>
                {primary.trashedAt ? (
                  <>
                    <dt className="text-muted-foreground">Deleted</dt>
                    <dd>{formatDate(primary.trashedAt)}</dd>
                    <dt className="text-muted-foreground">Auto-delete</dt>
                    <dd>
                      {primary.purgeAt == null
                        ? 'Never'
                        : formatDate(primary.purgeAt)}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Path</dt>
                <dd className="break-all font-mono text-[10px] text-muted-foreground">
                  {primary.originalKey || primary.relativeKey || '/'}
                </dd>
              </dl>
              <Separator />
              <FilesPreview
                item={primary}
                blob={blob}
                blobUrl={blobUrl}
                loading={previewLoading}
                error={previewError}
                onDownload={() => onDownload(primary)}
              />
            </>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
