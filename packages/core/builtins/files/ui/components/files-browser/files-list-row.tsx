import { FileIcon, FolderIcon } from '@phosphor-icons/react';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { Checkbox } from '@agentos/ui/components/checkbox';
import { TableCell, TableRow } from '@agentos/ui/components/table';
import { cn } from '@agentos/ui/lib/utils';

import {
  formatBytes,
  formatDate,
  type FilesListItem,
  type FilesSection,
} from '../../lib/files-types';
import { ItemActionsMenu } from './item-actions-menu';

export function FilesListRow({
  item,
  section,
  showLocation = false,
  selected,
  disabled,
  onOpen,
  onToggle,
  onRename,
  onDelete,
  onRestore,
}: {
  item: FilesListItem;
  section: FilesSection;
  showLocation?: boolean;
  selected: boolean;
  disabled: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRestore?: () => void;
}) {
  const Icon = item.kind === 'folder' ? FolderIcon : FileIcon;
  return (
    <TableRow
      className={cn(
        'border-border/60 hover:bg-muted/40',
        selected && 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <TableCell className="px-3 py-1.5">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${item.name}`}
          disabled={disabled}
        />
      </TableCell>
      <TableCell className="px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 max-w-full justify-start gap-2 px-1 font-normal"
          onClick={onOpen}
          disabled={disabled}
        >
          <Icon
            className={cn(
              'size-4 shrink-0',
              item.kind === 'folder'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground',
            )}
            aria-hidden
          />
          <span className="truncate">{item.name}</span>
          {showLocation && section === 'bin' && item.mountName ? (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {item.mountName}
            </Badge>
          ) : null}
        </Button>
      </TableCell>
      <TableCell className="hidden px-2 py-1.5 text-muted-foreground sm:table-cell">
        {item.kind === 'file' ? formatBytes(item.bytes) : '—'}
      </TableCell>
      <TableCell className="hidden px-2 py-1.5 text-muted-foreground md:table-cell">
        {formatDate(section === 'bin' ? item.trashedAt : item.updatedAt)}
      </TableCell>
      <TableCell className="px-2 py-1.5">
        <ItemActionsMenu
          section={section}
          onRename={onRename}
          onDelete={onDelete}
          onRestore={onRestore}
        />
      </TableCell>
    </TableRow>
  );
}
