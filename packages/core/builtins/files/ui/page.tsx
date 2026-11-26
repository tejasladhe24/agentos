import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useHostApi,
  useHostNavigation,
  useHostNotifications,
  useHostUi,
} from '@agentos/core/client';

import { FilesBrowser } from './files-browser';
import {
  encodeBlobPath,
  exportQuery,
  FILES_DETAIL_OPEN_CHANNEL,
  fileToBase64,
  formatBytes,
  itemId,
  joinPrefix,
  mountQuery,
  parseErrorBody,
  parseListResponse,
  PLATFORM_MOUNT_ID,
  resolveSelectedMount,
  type FilesBlobJson,
  type FilesListItem,
  type FilesMount,
  type FilesViewMode,
  type UploadProgressItem,
} from './files-types';
import { driveCopy, startDriveConnect } from './personal-drives';
import { useFilesMount } from './use-files-mount';
import { broadcastMountsChanged, useFilesMounts } from './use-files-mounts';
import { useFilesPrefix } from './use-files-prefix';
import { useFilesSection } from './use-files-section';
import { useFilesSelection } from './use-files-selection';

function folderPrefixFor(item: FilesListItem): string {
  if (item.kind !== 'folder') return '';
  return item.relativeKey.endsWith('/')
    ? item.relativeKey
    : `${item.relativeKey}/`;
}

function parentOfRelativeKey(relativeKey: string): string {
  const trimmed = relativeKey.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) return '';
  return `${trimmed.slice(0, idx + 1)}`;
}

function renameTargetKey(item: FilesListItem, newName: string): string {
  const parent = parentOfRelativeKey(
    item.kind === 'folder' ? folderPrefixFor(item) : item.relativeKey,
  );
  const next =
    item.kind === 'folder'
      ? `${parent}${newName.replace(/\/+$/, '')}/`
      : joinPrefix(parent.replace(/\/$/, ''), newName);
  return next;
}

function isReconnectError(body: string): boolean {
  try {
    return (
      (JSON.parse(body) as { code?: string }).code === 'reconnect_required'
    );
  } catch {
    return false;
  }
}

/**
 * Files secondary Activity Bar page — org-scoped Drive-style manager.
 */
export default function FilesPage() {
  const api = useHostApi();
  const navigation = useHostNavigation();
  const notifications = useHostNotifications();
  const ui = useHostUi();
  const [prefix, setPrefix] = useFilesPrefix();
  const [section] = useFilesSection();
  const [selectedMountId, setSelectedMountId] = useFilesMount();
  const [, setSharedSelection] = useFilesSelection();
  const { data: mountsData, loading: mountsLoading } = useFilesMounts();
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

  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>(
    [],
  );

  const selectedItems = useMemo(
    () => items.filter((i) => selectedKeys.has(itemId(i))),
    [items, selectedKeys],
  );

  useEffect(() => {
    let cancelled = false;
    void ui.isRightSidebarOpen().then((open) => {
      if (!cancelled) setDetailOpen(open);
    });
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(FILES_DETAIL_OPEN_CHANNEL)
        : null;
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'boolean') {
          setDetailOpen(event.data);
        }
      };
    }
    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [ui]);

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
      setError(parseErrorBody(res.body, 'Failed to load files'));
      setItems([]);
      setLoading(false);
      if (isReconnectError(res.body)) broadcastMountsChanged();
      return;
    }
    const list = parseListResponse(res.body);
    setItems(list.items);
    setLoading(false);
  }, [activeSearch, api, mountId, prefix, section]);

  const broadcastDetailOpen = useCallback((open: boolean) => {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(FILES_DETAIL_OPEN_CHANNEL);
      channel.postMessage(open);
      channel.close();
    }
  }, []);

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

  async function onUploadFiles(files: File[]) {
    if (unauthenticated || section !== 'files') return;
    const maxBytes = mount?.capabilities?.maxFileSize;
    const jobs: UploadProgressItem[] = files.map((file, i) => ({
      id: `${Date.now()}-${i}`,
      name: file.name,
      status: 'pending',
    }));
    setUploadProgress(jobs);

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]!;
      const jobId = jobs[i]!.id;
      setUploadProgress((prev) =>
        prev.map((p) => (p.id === jobId ? { ...p, status: 'uploading' } : p)),
      );
      try {
        if (maxBytes && file.size > maxBytes) {
          throw new Error(
            `exceeds ${mount?.name ?? 'storage'} limit of ${formatBytes(maxBytes)}`,
          );
        }
        const base64 = await fileToBase64(file);
        const key = joinPrefix(prefix, file.name);
        const path = encodeBlobPath(key);
        const res = await api.fetch(`/blobs/${path}${mountQuery(mountId)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            base64,
            contentType: file.type || 'application/octet-stream',
          }),
        });
        if (!res.ok) {
          throw new Error(parseErrorBody(res.body, 'Upload failed'));
        }
        setUploadProgress((prev) =>
          prev.map((p) => (p.id === jobId ? { ...p, status: 'done' } : p)),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setUploadProgress((prev) =>
          prev.map((p) =>
            p.id === jobId ? { ...p, status: 'error', error: message } : p,
          ),
        );
        await notifications.show(`${file.name}: ${message}`, 'error');
      }
    }

    await loadList();
    setTimeout(() => setUploadProgress([]), 4000);
  }

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
