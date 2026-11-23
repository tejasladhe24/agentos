import { Separator } from '@agentos/ui/components/separator';
import { Badge } from '@agentos/ui/components/badge';

import { FilesPreview } from './files-preview';
import {
  formatBytes,
  formatDate,
  type FilesBlobJson,
  type FilesListItem,
} from './files-types';

export type FilesDetailProps = {
  selection: FilesListItem[];
  primary: FilesListItem | null;
  blob: FilesBlobJson | null;
  blobUrl: string | null;
  previewLoading: boolean;
  previewError: string | null;
  onDownload: (item: FilesListItem) => void;
};

export function FilesDetail({
  selection,
  primary,
  blob,
  blobUrl,
  previewLoading,
  previewError,
  onDownload,
}: FilesDetailProps) {
  return (
    <aside
      data-slot="files-detail"
      className="flex w-full min-w-0 flex-col gap-3 rounded-md border border-border bg-card p-4 lg:w-72 lg:shrink-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Details</h2>
        <p className="text-xs text-muted-foreground">
          {selection.length === 0
            ? 'Select an item to see metadata and preview.'
            : selection.length === 1
              ? (primary?.name ?? 'Selected item')
              : `${selection.length} items selected`}
        </p>
      </header>
      <Separator />
      {selection.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No selection. Use the browser to select one or more files.
        </p>
      ) : null}
      {selection.length > 1 ? (
        <ul className="flex max-h-48 flex-col gap-1 overflow-auto text-xs">
          {selection.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{item.name}</span>
              <Badge variant="outline">{item.kind}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {primary && selection.length === 1 ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Kind</dt>
            <dd>
              <Badge variant="secondary">{primary.kind}</Badge>
            </dd>
            <dt className="text-muted-foreground">Size</dt>
            <dd>{formatBytes(primary.bytes)}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="truncate">{primary.contentType ?? '—'}</dd>
            <dt className="text-muted-foreground">Updated</dt>
            <dd>{formatDate(primary.updatedAt)}</dd>
            <dt className="text-muted-foreground">Key</dt>
            <dd className="break-all font-mono text-[10px]">
              {primary.relativeKey || '/'}
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
    </aside>
  );
}
