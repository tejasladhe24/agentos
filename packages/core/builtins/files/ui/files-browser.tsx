import { useId, useMemo, useState } from 'react';
import {
  DotsThreeIcon,
  FolderIcon,
  FileIcon,
  ListIcon,
  SquaresFourIcon,
  TrashIcon,
  PencilSimpleIcon,
  ArrowsLeftRightIcon,
} from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';
import { Checkbox } from '@agentos/ui/components/checkbox';
import { Badge } from '@agentos/ui/components/badge';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@agentos/ui/components/toggle-group';
import { LoadingState } from '@agentos/ui/components/loading-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@agentos/ui/components/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@agentos/ui/components/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentos/ui/components/dialog';
import { cn } from '@agentos/ui/lib/utils';

import {
  breadcrumbSegments,
  formatBytes,
  formatDate,
  type FilesListItem,
  type FilesViewMode,
} from './files-types';
import {
  FilesUploadZone,
  type FilesUploadZoneProps,
} from './files-upload-zone';

export type FilesBrowserProps = {
  prefix: string;
  items: FilesListItem[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  viewMode: FilesViewMode;
  selectedKeys: Set<string>;
  upload: Pick<FilesUploadZoneProps, 'progress' | 'onUploadFiles'>;
  disabled?: boolean;
  onSearchQueryChange: (q: string) => void;
  onSearchSubmit: () => void;
  onClearSearch: () => void;
  onViewModeChange: (mode: FilesViewMode) => void;
  onPrefixChange: (prefix: string) => void;
  onOpenItem: (item: FilesListItem) => void;
  onToggleSelect: (item: FilesListItem) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadSelected: () => void;
  onRename: (item: FilesListItem, newName: string) => Promise<void>;
  onMove: (items: FilesListItem[], destinationPrefix: string) => Promise<void>;
  onDelete: (items: FilesListItem[]) => Promise<void>;
};

export function FilesBrowser({
  prefix,
  items,
  loading,
  error,
  searchQuery,
  viewMode,
  selectedKeys,
  upload,
  disabled = false,
  onSearchQueryChange,
  onSearchSubmit,
  onClearSearch,
  onViewModeChange,
  onPrefixChange,
  onOpenItem,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onDownloadSelected,
  onRename,
  onMove,
  onDelete,
}: FilesBrowserProps) {
  const searchId = useId();
  const crumbs = useMemo(() => breadcrumbSegments(prefix), [prefix]);
  const allSelected =
    items.length > 0 && items.every((i) => selectedKeys.has(i.key));
  const selectedItems = items.filter((i) => selectedKeys.has(i.key));

  const [renameTarget, setRenameTarget] = useState<FilesListItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDest, setMoveDest] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<FilesListItem[]>([]);
  const [dialogBusy, setDialogBusy] = useState(false);

  function openRename(item: FilesListItem) {
    setRenameTarget(item);
    setRenameValue(item.name);
  }

  async function submitRename() {
    if (!renameTarget || !renameValue.trim()) return;
    setDialogBusy(true);
    try {
      await onRename(renameTarget, renameValue.trim());
      setRenameTarget(null);
    } finally {
      setDialogBusy(false);
    }
  }

  async function submitMove() {
    if (!selectedItems.length) return;
    setDialogBusy(true);
    try {
      await onMove(selectedItems, moveDest);
      setMoveOpen(false);
      setMoveDest('');
    } finally {
      setDialogBusy(false);
    }
  }

  function queueDelete(targets: FilesListItem[]) {
    setDeleteTargets(targets);
    setDeleteOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTargets.length) return;
    setDialogBusy(true);
    try {
      await onDelete(deleteTargets);
      setDeleteOpen(false);
      setDeleteTargets([]);
      onClearSelection();
    } finally {
      setDialogBusy(false);
    }
  }

  return (
    <section
      data-slot="files-browser"
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav
            aria-label="Breadcrumbs"
            className="flex flex-wrap items-center gap-1 text-sm"
          >
            {crumbs.map((crumb, i) => (
              <span
                key={crumb.prefix || 'root'}
                className="flex items-center gap-1"
              >
                {i > 0 ? (
                  <span className="text-muted-foreground">/</span>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => onPrefixChange(crumb.prefix)}
                >
                  {crumb.label}
                </Button>
              </span>
            ))}
          </nav>
          <ToggleGroup
            value={[viewMode]}
            onValueChange={(v) => {
              const next = v[0];
              if (next === 'grid' || next === 'list') onViewModeChange(next);
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <SquaresFourIcon className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <ListIcon className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
        >
          <Input
            id={searchId}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search by name…"
            className="max-w-xs"
            aria-label="Search files"
            disabled={disabled}
          />
          <Button type="submit" size="sm" disabled={disabled}>
            Search
          </Button>
          {searchQuery ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearSearch}
            >
              Clear
            </Button>
          ) : null}
        </form>

        <FilesToolbar
          disabled={disabled}
          selectedCount={selectedKeys.size}
          allSelected={allSelected}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          onDownloadSelected={onDownloadSelected}
          onMove={() => {
            setMoveDest(prefix);
            setMoveOpen(true);
          }}
          onDelete={() => queueDelete(selectedItems)}
        />
      </header>

      <FilesUploadZone
        disabled={disabled}
        progress={upload.progress}
        onUploadFiles={upload.onUploadFiles}
      />

      {error ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-slot="files-error"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <LoadingState>Loading files…</LoadingState>
      ) : items.length === 0 ? (
        <FilesEmpty searchActive={Boolean(searchQuery)} />
      ) : viewMode === 'grid' ? (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {items.map((item) => (
              <FilesGridCard
                key={item.key}
                item={item}
                selected={selectedKeys.has(item.key)}
                disabled={disabled}
                onOpen={() => onOpenItem(item)}
                onToggle={() => onToggleSelect(item)}
                onRename={() => openRename(item)}
                onDelete={() => queueDelete([item])}
              />
            ))}
          </ul>
        </ScrollArea>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="w-8 p-2" scope="col">
                  <span className="sr-only">Select</span>
                </th>
                <th className="p-2" scope="col">
                  Name
                </th>
                <th className="hidden p-2 sm:table-cell" scope="col">
                  Size
                </th>
                <th className="hidden p-2 md:table-cell" scope="col">
                  Updated
                </th>
                <th className="w-10 p-2" scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <FilesListRow
                  key={item.key}
                  item={item}
                  selected={selectedKeys.has(item.key)}
                  disabled={disabled}
                  onOpen={() => onOpenItem(item)}
                  onToggle={() => onToggleSelect(item)}
                  onRename={() => openRename(item)}
                  onDelete={() => queueDelete([item])}
                />
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            aria-label="New name"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRenameTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={dialogBusy || !renameValue.trim()}
              onClick={() => void submitRename()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to folder</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Destination prefix relative to org root (e.g. <code>docs/</code>).
            Moving {selectedItems.length} item(s).
          </p>
          <Input
            value={moveDest}
            onChange={(e) => setMoveDest(e.target.value)}
            aria-label="Destination prefix"
            placeholder="folder/subfolder/"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMoveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={dialogBusy || selectedItems.length === 0}
              onClick={() => void submitMove()}
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {deleteTargets.length} item(s). Folder
              deletes remove all objects under that prefix.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={dialogBusy}
              onClick={() => void confirmDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function FilesToolbar({
  disabled,
  selectedCount,
  allSelected,
  onSelectAll,
  onClearSelection,
  onDownloadSelected,
  onMove,
  onDelete,
}: {
  disabled: boolean;
  selectedCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadSelected: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-slot="files-toolbar"
      className="flex flex-wrap items-center gap-2 border-y py-2"
    >
      <Checkbox
        checked={allSelected}
        onCheckedChange={() =>
          allSelected ? onClearSelection() : onSelectAll()
        }
        aria-label="Select all in folder"
        disabled={disabled}
      />
      <Badge variant="outline">{selectedCount} selected</Badge>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || selectedCount === 0}
        onClick={onDownloadSelected}
      >
        Download
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled || selectedCount === 0}
        onClick={onMove}
      >
        <ArrowsLeftRightIcon className="size-4" aria-hidden />
        Move
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={disabled || selectedCount === 0}
        onClick={onDelete}
      >
        <TrashIcon className="size-4" aria-hidden />
        Delete
      </Button>
      {selectedCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
        >
          Clear selection
        </Button>
      ) : null}
    </div>
  );
}

function FilesEmpty({ searchActive }: { searchActive: boolean }) {
  return (
    <div
      data-slot="files-empty"
      className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      <FolderIcon className="size-10 opacity-60" aria-hidden />
      <p>
        {searchActive ? 'No files match your search.' : 'This folder is empty.'}
      </p>
      <p className="text-xs">Upload files or navigate to another folder.</p>
    </div>
  );
}

function FilesGridCard({
  item,
  selected,
  disabled,
  onOpen,
  onToggle,
  onRename,
  onDelete,
}: {
  item: FilesListItem;
  selected: boolean;
  disabled: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
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
        <ItemActionsMenu onRename={onRename} onDelete={onDelete} />
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

function FilesListRow({
  item,
  selected,
  disabled,
  onOpen,
  onToggle,
  onRename,
  onDelete,
}: {
  item: FilesListItem;
  selected: boolean;
  disabled: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const Icon = item.kind === 'folder' ? FolderIcon : FileIcon;
  return (
    <tr className={cn('border-b', selected && 'bg-muted/40')}>
      <td className="p-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${item.name}`}
          disabled={disabled}
        />
      </td>
      <td className="p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto justify-start gap-2 px-1 font-normal"
          onClick={onOpen}
          disabled={disabled}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{item.name}</span>
        </Button>
      </td>
      <td className="hidden p-2 text-muted-foreground sm:table-cell">
        {item.kind === 'file' ? formatBytes(item.bytes) : '—'}
      </td>
      <td className="hidden p-2 text-muted-foreground md:table-cell">
        {formatDate(item.updatedAt)}
      </td>
      <td className="p-2">
        <ItemActionsMenu onRename={onRename} onDelete={onDelete} />
      </td>
    </tr>
  );
}

function ItemActionsMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
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
        <DropdownMenuItem onClick={onRename}>
          <PencilSimpleIcon className="size-4" aria-hidden />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <TrashIcon className="size-4" aria-hidden />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
