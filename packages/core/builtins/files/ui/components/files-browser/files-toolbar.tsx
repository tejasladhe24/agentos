import {
  ArrowCounterClockwiseIcon,
  ArrowsLeftRightIcon,
  CopyIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';

import type { FilesSection } from '../../lib/files-types';

export function FilesToolbar({
  disabled,
  copyLabel,
  section,
  selectedCount,
  allSelected,
  onSelectAll,
  onClearSelection,
  onDownloadSelected,
  onMove,
  onCopyTo,
  onDelete,
  onRestore,
}: {
  disabled: boolean;
  copyLabel: string;
  section: FilesSection;
  selectedCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadSelected: () => void;
  onMove?: () => void;
  onCopyTo?: () => void;
  onDelete: () => void;
  onRestore?: () => void;
}) {
  return (
    <div
      data-slot="files-toolbar"
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5"
    >
      <Badge variant="secondary">{selectedCount} selected</Badge>
      {section !== 'bin' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={disabled || selectedCount === 0}
          onClick={onDownloadSelected}
        >
          Download
        </Button>
      ) : null}
      {onMove ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={disabled || selectedCount === 0}
          onClick={onMove}
        >
          <ArrowsLeftRightIcon className="size-4" aria-hidden />
          Move
        </Button>
      ) : null}
      {onCopyTo ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={disabled || selectedCount === 0}
          onClick={onCopyTo}
          data-slot="files-copy-to"
        >
          <CopyIcon className="size-4" aria-hidden />
          {copyLabel}
        </Button>
      ) : null}
      {onRestore ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={disabled || selectedCount === 0}
          onClick={onRestore}
        >
          <ArrowCounterClockwiseIcon className="size-4" aria-hidden />
          Restore
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-destructive hover:text-destructive"
        disabled={disabled || selectedCount === 0}
        onClick={onDelete}
      >
        <TrashIcon className="size-4" aria-hidden />
        {section === 'bin' ? 'Delete forever' : 'Delete'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={onClearSelection}
      >
        Clear
      </Button>
      {!allSelected ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={disabled}
          onClick={onSelectAll}
        >
          Select all
        </Button>
      ) : null}
    </div>
  );
}
