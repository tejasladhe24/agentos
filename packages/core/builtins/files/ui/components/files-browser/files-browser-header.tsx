import { useId } from 'react';
import {
  InfoIcon,
  ListIcon,
  SquaresFourIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@agentos/ui/components/toggle-group';
import { cn } from '@agentos/ui/lib/utils';

import type {
  FilesMount,
  FilesSection,
  FilesViewMode,
} from '../../lib/files-types';
import {
  FilesUploadZone,
  type FilesUploadZoneProps,
} from '../files-upload-zone';
import { MountIcon } from '../mount-icon';
import { FilesToolbar } from './files-toolbar';

export type FilesBrowserHeaderProps = {
  section: FilesSection;
  mount?: FilesMount;
  crumbs: Array<{ prefix: string; label: string }>;
  searchQuery: string;
  viewMode: FilesViewMode;
  detailOpen: boolean;
  disabled: boolean;
  needsReconnect: boolean;
  selectedKeys: Set<string>;
  allSelected: boolean;
  copyLabel: string;
  onUploadFiles: FilesUploadZoneProps['onUploadFiles'];
  onSearchQueryChange: (q: string) => void;
  onSearchSubmit: () => void;
  onClearSearch: () => void;
  onViewModeChange: (mode: FilesViewMode) => void;
  onToggleDetail: () => void;
  onPrefixChange: (prefix: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDownloadSelected: () => void;
  onReconnect?: (mount: FilesMount) => void;
  /** Toolbar actions; `undefined` hides the button. */
  onMove?: () => void;
  onCopyTo?: () => void;
  onDelete: () => void;
  onRestore?: () => void;
};

/** Breadcrumbs / title, search, upload, view toggle, details, selection bar. */
export function FilesBrowserHeader({
  section,
  mount,
  crumbs,
  searchQuery,
  viewMode,
  detailOpen,
  disabled,
  needsReconnect,
  selectedKeys,
  allSelected,
  copyLabel,
  onUploadFiles,
  onSearchQueryChange,
  onSearchSubmit,
  onClearSearch,
  onViewModeChange,
  onToggleDetail,
  onPrefixChange,
  onSelectAll,
  onClearSelection,
  onDownloadSelected,
  onReconnect,
  onMove,
  onCopyTo,
  onDelete,
  onRestore,
}: FilesBrowserHeaderProps) {
  const searchId = useId();
  const isDrive = section === 'files';
  const isStorage = section === 'storage';
  const title =
    section === 'bin' ? 'Bin' : section === 'storage' ? 'Storage' : null;

  return (
    <header
      className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 sm:px-4"
      data-files-mount={isDrive ? mount?.id : undefined}
    >
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
                  {i === 0 && mount ? (
                    <MountIcon
                      provider={mount.provider}
                      className="size-4 shrink-0"
                    />
                  ) : null}
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
            onUploadFiles={onUploadFiles}
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

      {isDrive && needsReconnect && mount ? (
        <div
          role="alert"
          data-slot="files-reconnect"
          className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          <WarningIcon
            className="size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            {mount.statusMessage ??
              `${mount.name} is disconnected. Reconnect to keep browsing.`}
          </span>
          {onReconnect ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onReconnect(mount)}
            >
              Reconnect
            </Button>
          ) : null}
        </div>
      ) : null}

      {selectedKeys.size > 0 ? (
        <FilesToolbar
          disabled={disabled}
          copyLabel={copyLabel}
          section={section}
          selectedCount={selectedKeys.size}
          allSelected={allSelected}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          onDownloadSelected={onDownloadSelected}
          onMove={onMove}
          onCopyTo={onCopyTo}
          onDelete={onDelete}
          onRestore={onRestore}
        />
      ) : null}
    </header>
  );
}
