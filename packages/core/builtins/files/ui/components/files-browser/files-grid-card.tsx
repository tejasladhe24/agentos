import { FileIcon, FolderIcon } from '@phosphor-icons/react';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { Checkbox } from '@agentos/ui/components/checkbox';
import { cn } from '@agentos/ui/lib/utils';

import {
  formatBytes,
  type FilesListItem,
  type FilesSection,
} from '../../lib/files-types';
import { ItemActionsMenu } from './item-actions-menu';

export function FilesGridCard({
  item,
  section,
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
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border p-2',
        selected && 'border-primary ring-1 ring-primary/30',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${item.name}`}
          disabled={disabled}
        />
        <ItemActionsMenu
          section={section}
          onRename={onRename}
          onDelete={onDelete}
          onRestore={onRestore}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        className="flex h-auto flex-col items-center gap-1 px-1 py-2 text-center font-normal"
        onClick={onOpen}
        disabled={disabled}
      >
        <Icon className="size-8 text-muted-foreground" aria-hidden />
        <span className="line-clamp-2 w-full text-xs font-medium">
          {item.name}
        </span>
        {item.kind === 'file' ? (
          <span className="text-[10px] text-muted-foreground">
            {formatBytes(item.bytes)}
          </span>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            Folder
          </Badge>
        )}
      </Button>
    </li>
  );
}
