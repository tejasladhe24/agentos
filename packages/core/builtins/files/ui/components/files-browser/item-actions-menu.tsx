import {
  ArrowCounterClockwiseIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@agentos/ui/components/dropdown-menu';

import type { FilesSection } from '../../lib/files-types';

export function ItemActionsMenu({
  section,
  onRename,
  onDelete,
  onRestore,
}: {
  section: FilesSection;
  onRename: () => void;
  onDelete: () => void;
  onRestore?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Item actions"
          />
        }
      >
        <DotsThreeIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {section === 'bin' ? (
          <>
            {onRestore ? (
              <DropdownMenuItem onClick={onRestore}>
                <ArrowCounterClockwiseIcon className="size-4" aria-hidden />
                Restore
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <TrashIcon className="size-4" aria-hidden />
              Delete forever
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onClick={onRename}>
              <PencilSimpleIcon className="size-4" aria-hidden />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <TrashIcon className="size-4" aria-hidden />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
