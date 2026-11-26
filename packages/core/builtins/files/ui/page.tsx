import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useHostApi,
  useHostEvent,
  useHostNavigation,
  useHostNotifications,
  useHostPublish,
  useHostUi,
} from '@agentos/core/client';

import { FilesBrowser } from './components/files-browser';
import {
  encodeBlobPath,
  exportQuery,
  FILES_DETAIL_OPEN_TOPIC,
  itemId,
  mountQuery,
  parseErrorBody,
  parseListResponse,
  PLATFORM_MOUNT_ID,
  resolveSelectedMount,
  type FilesBlobJson,
  type FilesListItem,
  type FilesMount,
  type FilesViewMode,
} from './lib/files-types';
import { driveCopy, startDriveConnect } from './lib/personal-drives';
import { useFilesMount } from './lib/use-files-mount';
import { useFilesMounts, useNotifyMountsChanged } from './lib/use-files-mounts';
import { useFilesPrefix } from './lib/use-files-prefix';
import { useFilesSection } from './lib/use-files-section';
import { useFilesSelection } from './lib/use-files-selection';
import { useFilesUpload } from './lib/use-files-upload';
import {
  folderPrefixFor,
  isReconnectError,
  renameTargetKey,
} from './lib/files-keys';

/**
 * Files secondary Activity Bar page — org-scoped Drive-style manager.
 */
export default function FilesPage() {
  const api = useHostApi();
  const navigation = useHostNavigation();
  const notifications = useHostNotifications();
  const ui = useHostUi();
  const { publishLocal } = useHostPublish();
  const notifyMountsChanged = useNotifyMountsChanged();
  const [prefix, setPrefix] = useFilesPrefix();
  const [section] = useFilesSection();
  const [selectedMountId, setSelectedMountId] = useFilesMount();
  const [, setSharedSelection] = useFilesSelection();
  const { data: mountsData, loading: mountsLoading } = useFilesMounts({
    reportErrors: true,
  });
  const mounts = mountsData.mounts;
  const mount = resolveSelectedMount(mounts, selectedMountId);
  const mountId = mount?.id ?? PLATFORM_MOUNT_ID;

  useEffect(() => {
    if (mountsLoading || !mounts.length) return;
    if (selectedMountId && !mounts.some((m) => m.id === selectedMountId)) {
      void setSelectedMountId('');
    }
  }, [mounts, mountsLoading, selectedMountId, setSelectedMountId]);

  /** Mount owning an item (cross-mount views carry it per item). */
  const mountOf = useCallback(
    (item: FilesListItem) => item.mountId ?? mountId,
    [mountId],
  );

  const [items, setItems] = useState<FilesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [viewMode, setViewMode] = useState<FilesViewMode>('list');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [detailOpen, setDetailOpen] = useState(false);

  const selectedItems = useMemo(
    () => items.filter((i) => selectedKeys.has(itemId(i))),
    [items, selectedKeys],
  );

  useEffect(() => {
    let cancelled = false;
    void ui.isRightSidebarOpen().then((open) => {
      if (!cancelled) setDetailOpen(open);
    });
    return () => {
      cancelled = true;
    };
  }, [ui]);

  useHostEvent(FILES_DETAIL_OPEN_TOPIC, (open) => {
    if (typeof open === 'boolean') setDetailOpen(open);
  });

  useEffect(() => {
    void setSharedSelection(selectedItems);
  }, [selectedItems, setSharedSelection]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUnauthenticated(false);

    const params = new URLSearchParams();
    params.set('limit', '100');
    if (section === 'bin') {
      params.set('view', 'bin');
    } else if (section === 'storage') {
      params.set('view', 'storage');
    } else {
      params.set('prefix', prefix);
      if (mountId !== PLATFORM_MOUNT_ID) params.set('mount', mountId);
      if (activeSearch) params.set('q', activeSearch);
    }

    const res = await api.fetch(`/blobs?${params.toString()}`);
    if (res.status === 401) {
      setUnauthenticated(true);
      setItems([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      const message = parseErrorBody(res.body, 'Failed to load files');
      setError(message);
      void notifications.show(message, 'error');
      setItems([]);
      setLoading(false);
      if (isReconnectError(res.body)) notifyMountsChanged();
      return;
    }
    const list = parseListResponse(res.body);
    setItems(list.items);
    setLoading(false);
  }, [
    activeSearch,
    api,
    mountId,
    notifications,
    notifyMountsChanged,
    prefix,
    section,
  ]);

  const broadcastDetailOpen = useCallback(
    (open: boolean) => {
      void publishLocal(FILES_DETAIL_OPEN_TOPIC, open).catch(() => {});
    },
    [publishLocal],
  );

  useEffect(() => {
    setSelectedKeys(new Set());
    setDetailOpen(false);
    void ui.setRightSidebarOpen(false);
    broadcastDetailOpen(false);
  }, [broadcastDetailOpen, section, mountId, ui]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function downloadItem(item: FilesListItem, format?: string) {
    if (item.kind === 'folder') return;
    const path = encodeBlobPath(item.relativeKey);
    const res = await api.fetch(
      `/blobs/${path}?format=json${mountQuery(mountOf(item), '&')}${exportQuery(item, format)}`,
    );
    if (!res.ok) {
      await notifications.show(
        parseErrorBody(res.body, 'Download failed'),
        'error',
      );
      return;
    }
    const blob = JSON.parse(res.body) as FilesBlobJson;
    const binary = atob(blob.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: blob.contentType || 'application/octet-stream',
      }),
    );
    const name = blob.name ?? item.name;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    await notifications.show(`Downloaded ${name}`, 'info');
  }

  async function reconnect(target: FilesMount) {
    const failure = await startDriveConnect(
      api,
      navigation,
      target.provider,
      target.id,
    );
    if (failure) await notifications.show(failure, 'error');
  }

  const { uploadProgress, onUploadFiles } = useFilesUpload({
    enabled: !unauthenticated && section === 'files',
    mount,
    mountId,
    prefix,
    reload: loadList,
  });

  async function onDelete(itemsToDelete: FilesListItem[]) {
    for (const item of itemsToDelete) {
      if (item.kind === 'folder') {
        const folderPrefix = folderPrefixFor(item);
        const res = await api.fetch(
          `/blobs?prefix=${encodeURIComponent(folderPrefix)}${mountQuery(mountOf(item), '&')}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          await notifications.show(
            parseErrorBody(res.body, `Failed to delete ${item.name}`),
            'error',
          );
          continue;
        }
      } else {
        const path = encodeBlobPath(item.relativeKey);
        const res = await api.fetch(
          `/blobs/${path}${mountQuery(mountOf(item))}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          await notifications.show(
            parseErrorBody(res.body, `Failed to delete ${item.name}`),
            'error',
          );
          continue;
        }
      }
    }
    setSelectedKeys(new Set());
    await notifications.show(
      section === 'bin'
        ? 'Permanently deleted'
        : `Moved to ${driveCopy(mount?.provider).trash ?? 'Bin'}`,
      'info',
    );
    await loadList();
  }

  async function onRestore(itemsToRestore: FilesListItem[]) {
    for (const item of itemsToRestore) {
      const res = await api.fetch('/blobs/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: item.relativeKey,
          mountId: mountOf(item),
        }),
      });
      if (!res.ok) {
        await notifications.show(
          parseErrorBody(res.body, `Failed to restore ${item.name}`),
          'error',
        );
      }
    }
    setSelectedKeys(new Set());
    await notifications.show('Restored from Bin', 'info');
    await loadList();
  }

  async function onRename(item: FilesListItem, newName: string) {
    const to = renameTargetKey(item, newName);
    const res = await api.fetch('/blobs/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: item.kind === 'folder' ? folderPrefixFor(item) : item.relativeKey,
        to,
        mount: mountOf(item),
      }),
    });
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Rename failed'));
    }
    await notifications.show('Renamed', 'info');
    await loadList();
  }

  async function onMove(
    itemsToMove: FilesListItem[],
    destinationPrefix: string,
  ) {
    const dest = destinationPrefix.endsWith('/')
      ? destinationPrefix
      : destinationPrefix
        ? `${destinationPrefix}/`
        : '';
    for (const item of itemsToMove) {
      const from =
        item.kind === 'folder' ? folderPrefixFor(item) : item.relativeKey;
      const to = `${dest}${item.name}${item.kind === 'folder' ? '/' : ''}`;
      const res = await api.fetch('/blobs/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, mount: mountOf(item) }),
      });
      if (!res.ok) {
        await notifications.show(
          parseErrorBody(res.body, `Failed to move ${item.name}`),
          'error',
        );
      }
    }
    setSelectedKeys(new Set());
    await notifications.show('Move completed', 'info');
    await loadList();
  }

  async function onCopyTo(
    itemsToCopy: FilesListItem[],
    targetMountId: string,
    destinationPrefix: string,
  ) {
    const dest = destinationPrefix.replace(/^\/+/, '').replace(/\/+$/, '');
    const target = mounts.find((m) => m.id === targetMountId);
    let copied = 0;
    for (const item of itemsToCopy) {
      const from =
        item.kind === 'folder' ? folderPrefixFor(item) : item.relativeKey;
      const name = `${item.name}${item.kind === 'folder' ? '/' : ''}`;
      const res = await api.fetch('/blobs/copy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: dest ? `${dest}/${name}` : name,
          fromMount: mountOf(item),
          toMount: targetMountId,
        }),
      });
      if (!res.ok) {
        await notifications.show(
          parseErrorBody(res.body, `Failed to copy ${item.name}`),
          'error',
        );
        continue;
      }
      copied += 1;
      if (itemsToCopy.length > 1) {
        await notifications.show(
          `Copying ${copied}/${itemsToCopy.length} to ${target?.name ?? 'storage'}…`,
          'info',
        );
      }
    }
    setSelectedKeys(new Set());
    await notifications.show(
      `Copied ${copied} item(s) to ${target?.name ?? 'storage'}`,
      'info',
    );
  }

  const disabled = unauthenticated;

  const browser = (
    <FilesBrowser
      section={section}
      prefix={prefix}
      items={items}
      loading={loading}
      error={error}
      searchQuery={searchQuery}
      viewMode={viewMode}
      selectedKeys={selectedKeys}
      detailOpen={detailOpen}
      disabled={disabled}
      upload={{ progress: uploadProgress, onUploadFiles }}
      onSearchQueryChange={setSearchQuery}
      onSearchSubmit={() => setActiveSearch(searchQuery.trim())}
      onClearSearch={() => {
        setSearchQuery('');
        setActiveSearch('');
      }}
      onViewModeChange={setViewMode}
      onToggleDetail={() => {
        void ui.toggleRightSidebar().then((next) => {
          setDetailOpen(next);
          broadcastDetailOpen(next);
        });
      }}
      onPrefixChange={(next) => void setPrefix(next)}
      onOpenItem={(item) => {
        if (section === 'files' && item.kind === 'folder') {
          void setPrefix(folderPrefixFor(item));
          setSelectedKeys(new Set());
          return;
        }
        setSelectedKeys(new Set([itemId(item)]));
      }}
      onToggleSelect={(item) => {
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          if (next.has(itemId(item))) next.delete(itemId(item));
          else next.add(itemId(item));
          return next;
        });
      }}
      onSelectAll={() => setSelectedKeys(new Set(items.map((i) => itemId(i))))}
      onClearSelection={() => setSelectedKeys(new Set())}
      onDownloadSelected={() => {
        void (async () => {
          for (const item of selectedItems.filter((i) => i.kind === 'file')) {
            await downloadItem(item);
          }
        })();
      }}
      onRename={onRename}
      onMove={onMove}
      onDelete={onDelete}
      onRestore={section === 'bin' ? onRestore : undefined}
      mount={mount}
      mounts={mounts}
      onCopyTo={onCopyTo}
      onReconnect={(target) => void reconnect(target)}
    />
  );

  return (
    <div
      className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-slot="files-page"
    >
      {unauthenticated ? (
        <p
          className="shrink-0 border-b border-border px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          You are not signed in. Open{' '}
          <span className="font-medium">/login</span> to access org files.
        </p>
      ) : null}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{browser}</div>
    </div>
  );
}
