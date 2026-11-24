import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from '@agentos/ui/components/resizable';
import { cn } from '@agentos/ui/lib/utils';

import { FilesBrowser } from './files-browser';
import { FilesDetail } from './files-detail';
import {
  encodeBlobPath,
  fileToBase64,
  formatBytes,
  itemId,
  joinPrefix,
  mountQuery,
  parseErrorBody,
  parseListResponse,
  PLATFORM_MOUNT_ID,
  type FilesBlobJson,
  type FilesListItem,
  type FilesViewMode,
  type UploadProgressItem,
} from './files-types';
import { useFilesMount } from './use-files-mount';
import { useFilesMounts } from './use-files-mounts';
import { useFilesPrefix } from './use-files-prefix';
import { useFilesSection } from './use-files-section';

const DETAIL_DEFAULT_SIZE_PX = 320;
const DETAIL_MIN_SIZE_PX = 240;
const DETAIL_MAX_SIZE = '45%';

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

/**
 * Files secondary Activity Bar page — org-scoped Drive-style manager.
 */
export default function FilesPage() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [prefix, setPrefix] = useFilesPrefix();
  const [section] = useFilesSection();
  const [selectedMountId, setSelectedMountId] = useFilesMount();
  const { data: mountsData, loading: mountsLoading } = useFilesMounts();
  const mounts = mountsData.mounts;
  const mount =
    mounts.find((m) => m.id === selectedMountId) ??
    mounts.find((m) => m.id === PLATFORM_MOUNT_ID);
  const mountId = mount?.id ?? PLATFORM_MOUNT_ID;

  useEffect(() => {
    if (mountsLoading || !mounts.length) return;
    if (!mounts.some((m) => m.id === selectedMountId)) {
      void setSelectedMountId(PLATFORM_MOUNT_ID);
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
  const detailPanelRef = usePanelRef();
  /** Last expanded width so reopening restores the user's size. */
  const lastDetailSizePxRef = useRef(DETAIL_DEFAULT_SIZE_PX);

  useEffect(() => {
    const panel = detailPanelRef.current;
    if (!panel) return;
    if (detailOpen) {
      if (panel.isCollapsed()) panel.expand();
      panel.resize(lastDetailSizePxRef.current);
    } else if (!panel.isCollapsed()) {
      const { inPixels } = panel.getSize();
      if (inPixels >= DETAIL_MIN_SIZE_PX)
        lastDetailSizePxRef.current = inPixels;
      panel.collapse();
    }
  }, [detailOpen, detailPanelRef]);

  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>(
    [],
  );

  const [previewBlob, setPreviewBlob] = useState<FilesBlobJson | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const selectedItems = useMemo(
    () => items.filter((i) => selectedKeys.has(itemId(i))),
    [items, selectedKeys],
  );

  const primary =
    selectedItems.length === 1 ? (selectedItems[0] ?? null) : null;

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

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
      return;
    }
    const list = parseListResponse(res.body);
    setItems(list.items);
    setLoading(false);
  }, [activeSearch, api, mountId, prefix, section]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setDetailOpen(false);
  }, [section, mountId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    revokePreviewUrl();
    setPreviewBlob(null);
    setPreviewError(null);

    if (!detailOpen || !primary || primary.kind !== 'file') {
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setPreviewLoading(true);
      const path = encodeBlobPath(primary.relativeKey);
      const res = await api.fetch(
        `/blobs/${path}?format=json${mountQuery(mountOf(primary), '&')}`,
      );
      if (cancelled) return;
      if (!res.ok) {
        setPreviewError(parseErrorBody(res.body, 'Preview failed'));
        setPreviewLoading(false);
        return;
      }
      try {
        const blob = JSON.parse(res.body) as FilesBlobJson;
        setPreviewBlob(blob);
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
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setPreviewError(null);
      } catch {
        setPreviewError('Could not decode file for preview');
      }
      setPreviewLoading(false);
    })();

    return () => {
      cancelled = true;
      revokePreviewUrl();
    };
  }, [api, detailOpen, mountOf, primary, revokePreviewUrl]);

  async function downloadItem(item: FilesListItem) {
    if (item.kind === 'folder') return;
    const path = encodeBlobPath(item.relativeKey);
    const res = await api.fetch(
      `/blobs/${path}?format=json${mountQuery(mountOf(item), '&')}`,
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
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.name;
    anchor.click();
    URL.revokeObjectURL(url);
    await notifications.show(`Downloaded ${item.name}`, 'info');
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
      section === 'bin' ? 'Permanently deleted' : 'Moved to Bin',
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
      onToggleDetail={() => setDetailOpen((open) => !open)}
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
    />
  );

  const detail = (
    <FilesDetail
      open={detailOpen}
      selection={selectedItems}
      primary={primary}
      blob={previewBlob}
      blobUrl={previewUrl}
      previewLoading={previewLoading}
      previewError={previewError}
      onDownload={downloadItem}
      onClose={() => setDetailOpen(false)}
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
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 min-w-0 flex-1"
        data-slot="files-layout"
      >
        <ResizablePanel
          id="files-browser"
          defaultSize="70%"
          minSize="40%"
          className="min-h-0 min-w-0"
        >
          {browser}
        </ResizablePanel>
        <ResizableHandle
          withHandle
          disabled={!detailOpen}
          className={cn(!detailOpen && 'hidden')}
        />
        <ResizablePanel
          id="files-detail"
          panelRef={detailPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={detailOpen ? DETAIL_DEFAULT_SIZE_PX : 0}
          minSize={DETAIL_MIN_SIZE_PX}
          maxSize={DETAIL_MAX_SIZE}
          className="min-h-0"
        >
          {detail}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
