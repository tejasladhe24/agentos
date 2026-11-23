import { useId, useMemo, useState } from 'react';
import {
  DotsThreeIcon,
  FolderIcon,
  FileIcon,
  InfoIcon,
  ListIcon,
  SquaresFourIcon,
  TrashIcon,
  PencilSimpleIcon,
  ArrowsLeftRightIcon,
  ArrowCounterClockwiseIcon,
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
  type FilesSection,
  type FilesViewMode,
} from './files-types';
import {
  FilesUploadZone,
  type FilesUploadZoneProps,
} from './files-upload-zone';

export type FilesBrowserProps = {
  section: FilesSection;
  prefix: string;
  items: FilesListItem[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  viewMode: FilesViewMode;
  selectedKeys: Set<string>;
  detailOpen: boolean;
  upload: Pick<FilesUploadZoneProps, 'progress' | 'onUploadFiles'>;
  disabled?: boolean;
  onSearchQueryChange: (q: string) => void;
  onSearchSubmit: () => void;
  onClearSearch: () => void;
  onViewModeChange: (mode: FilesViewMode) => void;
  onToggleDetail: () => void;
  onPrefixChange: (prefix: string) => void;
  onOpenItem: (item: FilesListItem) => void;
  onToggleSelect: (item: FilesListItem) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadSelected: () => void;
  onRename: (item: FilesListItem, newName: string) => Promise<void>;
  onMove: (items: FilesListItem[], destinationPrefix: string) => Promise<void>;
  onDelete: (items: FilesListItem[]) => Promise<void>;
  onRestore?: (items: FilesListItem[]) => Promise<void>;
};

export function FilesBrowser({
  section,
  prefix,
  items,
  loading,
  error,
  searchQuery,
  viewMode,
  selectedKeys,
  detailOpen,
  upload,
  disabled = false,
  onSearchQueryChange,
  onSearchSubmit,
  onClearSearch,
  onViewModeChange,
  onToggleDetail,
  onPrefixChange,
  onOpenItem,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onDownloadSelected,
  onRename,
  onMove,
  onDelete,
  onRestore,
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

  const isDrive = section === 'files';
  const isBin = section === 'bin';
  const isStorage = section === 'storage';
  const title =
    section === 'bin' ? 'Bin' : section === 'storage' ? 'Storage' : null;

  return (
    <section
      data-slot="files-browser"
      data-files-section={section}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          {isDrive ? (
            <nav
              aria-label="Breadcrumbs"
              className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-sm"
            >
              {crumbs.map((crumb, i) => (
                <span
                  key={crumb.prefix || 'root'}
                  className="flex items-center gap-0.5"
                >
                  {i > 0 ? (
                    <span className="text-muted-foreground" aria-hidden>
                      /
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'max-w-[12rem] truncate px-2',
                      i === crumbs.length - 1 && 'font-semibold',
                    )}
                    onClick={() => onPrefixChange(crumb.prefix)}
                  >
                    {crumb.label}
                  </Button>
                </span>
              ))}
            </nav>
          ) : (
            <div className="flex h-7 min-w-0 flex-1 items-center">
              <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            </div>
          )}
          {isDrive ? (
            <form
              className="flex min-w-0 flex-[2] items-center gap-2 sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
              onSubmit={(e) => {
                e.preventDefault();
                onSearchSubmit();
              }}
            >
              <Input
                id={searchId}
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="Search in Drive"
                className="h-7"
                aria-label="Search files"
                disabled={disabled}
              />
              {searchQuery ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={onClearSearch}
                >
                  Clear
                </Button>
              ) : null}
            </form>
          ) : null}
          {isDrive ? (
            <FilesUploadZone
              variant="button"
              disabled={disabled}
              onUploadFiles={upload.onUploadFiles}
            />
          ) : null}
          {!isStorage ? (
            <ToggleGroup
              value={[viewMode]}
              onValueChange={(v) => {
                const next = v[0];
                if (next === 'grid' || next === 'list') onViewModeChange(next);
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="list" aria-label="List view">
                <ListIcon className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <SquaresFourIcon className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          <Button
            type="button"
            variant={detailOpen ? 'secondary' : 'outline'}
            size="icon-sm"
            aria-label={detailOpen ? 'Hide details' : 'Show details'}
            aria-pressed={detailOpen}
            data-slot="files-info-button"
            onClick={onToggleDetail}
          >
            <InfoIcon className="size-4" />
          </Button>
        </div>

        {selectedKeys.size > 0 ? (
          <FilesToolbar
            disabled={disabled}
            section={section}
            selectedCount={selectedKeys.size}
            allSelected={allSelected}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
            onDownloadSelected={onDownloadSelected}
            onMove={
              isDrive
                ? () => {
                    setMoveDest(prefix);
                    setMoveOpen(true);
                  }
                : undefined
            }
            onDelete={() => queueDelete(selectedItems)}
            onRestore={
              isBin && onRestore
                ? () => void onRestore(selectedItems)
                : undefined
            }
          />
        ) : null}
      </header>

      {error ? (
        <p
          className="shrink-0 px-4 py-2 text-sm text-destructive"
          role="alert"
          data-slot="files-error"
        >
          {error}
        </p>
      ) : null}

      {isDrive ? (
        <FilesUploadZone
          variant="surface"
          disabled={disabled}
          progress={upload.progress}
          onUploadFiles={upload.onUploadFiles}
          className="min-h-0 flex-1"
        >
          <FilesBrowserBody
            section={section}
            items={items}
            loading={loading}
            searchQuery={searchQuery}
            viewMode={viewMode}
            selectedKeys={selectedKeys}
            allSelected={allSelected}
            disabled={disabled}
            onOpenItem={onOpenItem}
            onToggleSelect={onToggleSelect}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
            onRename={openRename}
            onDelete={queueDelete}
            onRestore={onRestore}
          />
        </FilesUploadZone>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <FilesBrowserBody
            section={section}
            items={items}
            loading={loading}
            searchQuery={searchQuery}
            viewMode={viewMode}
            selectedKeys={selectedKeys}
            allSelected={allSelected}
            disabled={disabled}
            onOpenItem={onOpenItem}
            onToggleSelect={onToggleSelect}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
            onRename={openRename}
            onDelete={queueDelete}
            onRestore={onRestore}
          />
        </div>
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
            <AlertDialogTitle>
              {isBin ? 'Delete permanently?' : 'Move to Bin?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isBin
                ? `Permanently deletes ${deleteTargets.length} item(s) from Bin.`
                : `Moves ${deleteTargets.length} item(s) to Bin. They can be restored until auto-delete runs.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={dialogBusy}
              onClick={() => void confirmDelete()}
            >
              {isBin ? 'Delete forever' : 'Move to Bin'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function FilesBrowserBody({
  section,
  items,
  loading,
  searchQuery,
  viewMode,
  selectedKeys,
  allSelected,
  disabled,
  onOpenItem,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onRename,
  onDelete,
  onRestore,
}: {
  section: FilesSection;
  items: FilesListItem[];
  loading: boolean;
  searchQuery: string;
  viewMode: FilesViewMode;
  selectedKeys: Set<string>;
  allSelected: boolean;
  disabled: boolean;
  onOpenItem: (item: FilesListItem) => void;
  onToggleSelect: (item: FilesListItem) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRename: (item: FilesListItem) => void;
  onDelete: (items: FilesListItem[]) => void;
  onRestore?: (items: FilesListItem[]) => Promise<void>;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <LoadingState>Loading files…</LoadingState>
      </div>
    );
  }

  if (items.length === 0) {
    return <FilesEmpty section={section} searchActive={Boolean(searchQuery)} />;
  }

  if (section === 'storage') {
    return (
      <ScrollArea className="h-full">
        <table className="w-full text-left text-sm" data-slot="files-storage">
          <thead className="sticky top-0 z-[1] bg-background">
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium" scope="col">
                Name
              </th>
              <th className="px-4 py-2 text-right font-medium" scope="col">
                Size
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.key}
                className="border-b border-border/60 hover:bg-muted/40"
              >
                <td className="px-4 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 max-w-full justify-start gap-2 px-1 font-normal"
                    onClick={() => onOpenItem(item)}
                  >
                    <FileIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="truncate">{item.name}</span>
                  </Button>
                </td>
                <td className="px-4 py-2 text-right text-muted-foreground tabular-nums">
                  {formatBytes(item.bytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    );
  }

  if (viewMode === 'grid') {
    return (
      <ScrollArea className="h-full">
        <ul className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <FilesGridCard
              key={item.key}
              item={item}
              section={section}
              selected={selectedKeys.has(item.key)}
              disabled={disabled}
              onOpen={() => onOpenItem(item)}
              onToggle={() => onToggleSelect(item)}
              onRename={() => onRename(item)}
              onDelete={() => onDelete([item])}
              onRestore={
                onRestore ? () => void onRestore([item]) : undefined
              }
            />
          ))}
        </ul>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-[1] bg-background">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="w-10 px-3 py-2" scope="col">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() =>
                  allSelected ? onClearSelection() : onSelectAll()
                }
                aria-label="Select all"
                disabled={disabled || items.length === 0}
              />
            </th>
            <th className="px-2 py-2 font-medium" scope="col">
              Name
            </th>
            <th
              className="hidden px-2 py-2 font-medium sm:table-cell"
              scope="col"
            >
              Size
            </th>
            <th
              className="hidden px-2 py-2 font-medium md:table-cell"
              scope="col"
            >
              {section === 'bin' ? 'Deleted' : 'Modified'}
            </th>
            <th className="w-10 px-2 py-2" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <FilesListRow
              key={item.key}
              item={item}
              section={section}
              selected={selectedKeys.has(item.key)}
              disabled={disabled}
              onOpen={() => onOpenItem(item)}
              onToggle={() => onToggleSelect(item)}
              onRename={() => onRename(item)}
              onDelete={() => onDelete([item])}
              onRestore={
                onRestore ? () => void onRestore([item]) : undefined
              }
            />
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function FilesToolbar({
  disabled,
  section,
  selectedCount,
  allSelected,
  onSelectAll,
  onClearSelection,
  onDownloadSelected,
  onMove,
  onDelete,
  onRestore,
}: {
  disabled: boolean;
  section: FilesSection;
  selectedCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadSelected: () => void;
  onMove?: () => void;
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

function FilesEmpty({
  section,
  searchActive,
}: {
  section: FilesSection;
  searchActive: boolean;
}) {
  const copy =
    section === 'bin'
      ? {
          title: 'Bin is empty',
          hint: 'Deleted files show up here until they are restored or auto-deleted.',
        }
      : section === 'storage'
        ? {
            title: 'No files yet',
            hint: 'Upload files in My Files to see storage usage.',
          }
        : {
            title: searchActive
              ? 'No files match your search.'
              : 'This folder is empty.',
            hint: 'Drop files here or use Upload.',
          };

  return (
    <div
      data-slot="files-empty"
      className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground"
    >
      <FolderIcon className="size-10 opacity-60" aria-hidden />
      <p>{copy.title}</p>
      <p className="text-xs">{copy.hint}</p>
    </div>
  );
}

function FilesGridCard({
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

function FilesListRow({
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
    <tr
      className={cn(
        'border-b border-border/60 transition-colors hover:bg-muted/40',
        selected && 'bg-primary/10 hover:bg-primary/15',
      )}
    >
      <td className="px-3 py-1.5">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${item.name}`}
          disabled={disabled}
        />
      </td>
      <td className="px-2 py-1.5">
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
        </Button>
      </td>
      <td className="hidden px-2 py-1.5 text-muted-foreground sm:table-cell">
        {item.kind === 'file' ? formatBytes(item.bytes) : '—'}
      </td>
      <td className="hidden px-2 py-1.5 text-muted-foreground md:table-cell">
        {formatDate(section === 'bin' ? item.trashedAt : item.updatedAt)}
      </td>
      <td className="px-2 py-1.5">
        <ItemActionsMenu
          section={section}
          onRename={onRename}
          onDelete={onDelete}
          onRestore={onRestore}
        />
      </td>
    </tr>
  );
}

function ItemActionsMenu({
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
