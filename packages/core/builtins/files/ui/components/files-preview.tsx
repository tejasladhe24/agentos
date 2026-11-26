import { DownloadSimpleIcon, FileIcon } from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { LoadingState } from '@agentos/ui/components/loading-state';

import {
  formatBytes,
  formatDate,
  isImageContentType,
  isPdfContentType,
  type FilesBlobJson,
  type FilesListItem,
} from '../lib/files-types';

export type FilesPreviewProps = {
  item: FilesListItem;
  blob: FilesBlobJson | null;
  blobUrl: string | null;
  loading: boolean;
  error: string | null;
  onDownload: () => void;
};

export function FilesPreview({
  item,
  blob,
  blobUrl,
  loading,
  error,
  onDownload,
}: FilesPreviewProps) {
  if (item.kind === 'folder') {
    return (
      <div
        data-slot="files-preview"
        className="flex flex-col items-center gap-2 p-4 text-center text-sm text-muted-foreground"
      >
        <FileIcon className="size-10" aria-hidden />
        <p>Folders cannot be previewed. Open the folder to browse contents.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div data-slot="files-preview">
        <LoadingState size="sm">Loading preview…</LoadingState>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-slot="files-preview"
        className="flex flex-col gap-2 p-4 text-sm text-destructive"
        role="alert"
      >
        {error}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onDownload}
        >
          Try download
        </Button>
      </div>
    );
  }

  const contentType = blob?.contentType ?? item.contentType;
  const canImage = isImageContentType(contentType) && blobUrl;
  const canPdf = isPdfContentType(contentType) && blobUrl;

  return (
    <div
      data-slot="files-preview"
      className="flex flex-col gap-3 overflow-hidden"
    >
      {canImage ? (
        <img
          src={blobUrl}
          alt={item.name}
          className="max-h-64 w-full object-contain bg-muted/30"
        />
      ) : null}
      {canPdf ? (
        <iframe
          title={item.name}
          src={blobUrl}
          className="h-64 w-full border border-border bg-background"
        />
      ) : null}
      {!canImage && !canPdf ? (
        <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-muted-foreground">
          <FileIcon className="size-10" aria-hidden />
          <p>Preview is not available for this file type.</p>
          <dl className="w-full text-left text-xs">
            <div className="flex justify-between gap-2 border-b py-1">
              <dt className="text-muted-foreground">Type</dt>
              <dd>{contentType ?? 'Unknown'}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b py-1">
              <dt className="text-muted-foreground">Size</dt>
              <dd>{formatBytes(blob?.bytes ?? item.bytes)}</dd>
            </div>
            <div className="flex justify-between gap-2 py-1">
              <dt className="text-muted-foreground">Updated</dt>
              <dd>{formatDate(blob?.updatedAt ?? item.updatedAt)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={onDownload}
      >
        <DownloadSimpleIcon className="size-4" aria-hidden />
        Download
      </Button>
    </div>
  );
}
