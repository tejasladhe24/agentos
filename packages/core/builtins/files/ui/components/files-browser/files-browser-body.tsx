import { FileIcon } from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { Checkbox } from '@agentos/ui/components/checkbox';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

import {
  formatBytes,
  itemId,
  type FilesListItem,
  type FilesSection,
  type FilesViewMode,
} from '../../lib/files-types';
import { FilesEmpty } from './files-empty';
import { FilesGridCard } from './files-grid-card';
import { FilesListRow } from './files-list-row';

export function FilesBrowserBody({
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
  showLocation = false,
  maxFileSize,
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
  showLocation?: boolean;
  maxFileSize?: number;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <LoadingState>Loading files…</LoadingState>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <FilesEmpty
        section={section}
        searchActive={Boolean(searchQuery)}
        maxFileSize={maxFileSize}
      />
    );
  }

  if (section === 'storage') {
    return (
      <ScrollArea className="h-full">
        <Table
          className="text-left text-sm"
          containerClassName="overflow-visible"
          data-slot="files-storage"
        >
          <TableHeader className="sticky top-0 z-[1] bg-background">
            <TableRow className="border-border text-xs text-muted-foreground hover:bg-transparent">
              <TableHead
                className="h-auto text-muted-foreground px-4 py-2 font-medium"
                scope="col"
              >
                Name
              </TableHead>
              {showLocation ? (
                <TableHead
                  className="h-auto text-muted-foreground px-4 py-2 font-medium"
                  scope="col"
                >
                  Location
                </TableHead>
              ) : null}
              <TableHead
                className="h-auto text-muted-foreground px-4 py-2 text-right font-medium"
                scope="col"
              >
                Size
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={itemId(item)}
                className="border-border/60 hover:bg-muted/40"
              >
                <TableCell className="px-4 py-2">
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
                </TableCell>
                {showLocation ? (
                  <TableCell className="px-4 py-2 text-muted-foreground">
                    {item.mountName ?? item.mountId ?? '—'}
                  </TableCell>
                ) : null}
                <TableCell className="px-4 py-2 text-right text-muted-foreground tabular-nums">
                  {formatBytes(item.bytes)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    );
  }

  if (viewMode === 'grid') {
    return (
      <ScrollArea className="h-full">
        <ul className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <FilesGridCard
              key={itemId(item)}
              item={item}
              section={section}
              selected={selectedKeys.has(itemId(item))}
              disabled={disabled}
              onOpen={() => onOpenItem(item)}
              onToggle={() => onToggleSelect(item)}
              onRename={() => onRename(item)}
              onDelete={() => onDelete([item])}
              onRestore={onRestore ? () => void onRestore([item]) : undefined}
            />
          ))}
        </ul>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <Table
        className="text-left text-sm"
        containerClassName="overflow-visible"
      >
        <TableHeader className="sticky top-0 z-[1] bg-background">
          <TableRow className="border-border text-xs text-muted-foreground hover:bg-transparent">
            <TableHead
              className="h-auto text-muted-foreground w-10 px-3 py-2"
              scope="col"
            >
              <Checkbox
                checked={allSelected}
                onCheckedChange={() =>
                  allSelected ? onClearSelection() : onSelectAll()
                }
                aria-label="Select all"
                disabled={disabled || items.length === 0}
              />
            </TableHead>
            <TableHead
              className="h-auto text-muted-foreground px-2 py-2 font-medium"
              scope="col"
            >
              Name
            </TableHead>
            <TableHead
              className="h-auto text-muted-foreground hidden px-2 py-2 font-medium sm:table-cell"
              scope="col"
            >
              Size
            </TableHead>
            <TableHead
              className="h-auto text-muted-foreground hidden px-2 py-2 font-medium md:table-cell"
              scope="col"
            >
              {section === 'bin' ? 'Deleted' : 'Modified'}
            </TableHead>
            <TableHead
              className="h-auto text-muted-foreground w-10 px-2 py-2"
              scope="col"
            >
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <FilesListRow
              key={itemId(item)}
              item={item}
              section={section}
              showLocation={showLocation}
              selected={selectedKeys.has(itemId(item))}
              disabled={disabled}
              onOpen={() => onOpenItem(item)}
              onToggle={() => onToggleSelect(item)}
              onRename={() => onRename(item)}
              onDelete={() => onDelete([item])}
              onRestore={onRestore ? () => void onRestore([item]) : undefined}
            />
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
