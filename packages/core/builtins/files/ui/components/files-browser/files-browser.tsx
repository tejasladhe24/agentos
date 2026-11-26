import { useMemo, useState } from 'react';

import {
  breadcrumbSegments,
  itemId,
  type FilesListItem,
  type FilesMount,
  type FilesSection,
  type FilesViewMode,
} from '../../lib/files-types';
import {
  FilesUploadZone,
  type FilesUploadZoneProps,
} from '../files-upload-zone';
import { FilesBrowserBody } from './files-browser-body';
import { FilesBrowserHeader } from './files-browser-header';
import {
  CopyDialog,
  DeleteDialog,
  MoveDialog,
  RenameDialog,
  useCopyForm,
  useMoveForm,
  useRenameForm,
} from './files-dialogs';

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
  /** Selected mount (browse root + capabilities). */
  mount?: FilesMount;
  /** All visible mounts (cross-mount copy targets, location column). */
  mounts?: FilesMount[];
  onCopyTo?: (
    items: FilesListItem[],
    mountId: string,
    destinationPrefix: string,
  ) => Promise<void>;
  /** Personal mount lost its token — start the provider reconnect flow. */
  onReconnect?: (mount: FilesMount) => void;
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
  mount,
  mounts = [],
  onCopyTo,
  onReconnect,
}: FilesBrowserProps) {
  const rootLabel = mount?.name ?? 'Files';
  const crumbs = useMemo(
    () => breadcrumbSegments(prefix, rootLabel),
    [prefix, rootLabel],
  );
  const capabilities = mount?.capabilities;
  const nativeTrash = capabilities?.nativeTrash === true;
  const personalSource = mount?.kind === 'personal';
  // Personal files only leave the drive into org storage.
  const copyTargets = mounts.filter(
    (m) =>
      m.status === 'connected' &&
      (!personalSource || m.kind === 'org' || m.id === mount?.id),
  );
  const needsReconnect =
    personalSource && mount !== undefined && mount.status !== 'connected';
  const canCopyAcross = Boolean(onCopyTo) && copyTargets.length > 1;
  const showLocation = mounts.length > 1;
  const [copyOpen, setCopyOpen] = useState(false);
  const allSelected =
    items.length > 0 && items.every((i) => selectedKeys.has(itemId(i)));
  const selectedItems = items.filter((i) => selectedKeys.has(itemId(i)));

  const [renameTarget, setRenameTarget] = useState<FilesListItem | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<FilesListItem[]>([]);
  const [dialogBusy, setDialogBusy] = useState(false);

  const renameForm = useRenameForm({
    target: renameTarget,
    onRename,
    onDone: () => setRenameTarget(null),
  });
  const moveForm = useMoveForm({
    selectedItems,
    onMove,
    onDone: () => setMoveOpen(false),
  });
  const copyForm = useCopyForm({
    selectedItems,
    onCopyTo,
    onDone: () => setCopyOpen(false),
  });

  function openRename(item: FilesListItem) {
    setRenameTarget(item);
    renameForm.reset({ name: item.name });
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

  const bodyProps = {
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
    onRename: openRename,
    onDelete: queueDelete,
    onRestore,
    showLocation,
  };

  return (
    <section
      data-slot="files-browser"
      data-files-section={section}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <FilesBrowserHeader
        section={section}
        mount={mount}
        crumbs={crumbs}
        searchQuery={searchQuery}
        viewMode={viewMode}
        detailOpen={detailOpen}
        disabled={disabled}
        needsReconnect={needsReconnect}
        selectedKeys={selectedKeys}
        allSelected={allSelected}
        copyLabel={personalSource ? 'Copy to org storage' : 'Copy to…'}
        onUploadFiles={upload.onUploadFiles}
        onSearchQueryChange={onSearchQueryChange}
        onSearchSubmit={onSearchSubmit}
        onClearSearch={onClearSearch}
        onViewModeChange={onViewModeChange}
        onToggleDetail={onToggleDetail}
        onPrefixChange={onPrefixChange}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
        onDownloadSelected={onDownloadSelected}
        onReconnect={onReconnect}
        onMove={
          isDrive
            ? () => {
                moveForm.reset({ destination: prefix });
                setMoveOpen(true);
              }
            : undefined
        }
        onCopyTo={
          isDrive && canCopyAcross
            ? () => {
                const first = copyTargets.find((m) => m.id !== mount?.id);
                copyForm.reset({
                  mountId: first?.id ?? '',
                  destination: '',
                });
                setCopyOpen(true);
              }
            : undefined
        }
        onDelete={() => queueDelete(selectedItems)}
        onRestore={
          isBin && onRestore ? () => void onRestore(selectedItems) : undefined
        }
      />

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
            {...bodyProps}
            maxFileSize={capabilities?.maxFileSize}
          />
        </FilesUploadZone>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <FilesBrowserBody {...bodyProps} />
        </div>
      )}

      <RenameDialog
        target={renameTarget}
        form={renameForm}
        onClose={() => setRenameTarget(null)}
      />
      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        form={moveForm}
        selectedCount={selectedItems.length}
      />
      <CopyDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        form={copyForm}
        selectedCount={selectedItems.length}
        personalSource={personalSource}
        mount={mount}
        copyTargets={copyTargets}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        isBin={isBin}
        nativeTrash={nativeTrash}
        mount={mount}
        targetCount={deleteTargets.length}
        busy={dialogBusy}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
