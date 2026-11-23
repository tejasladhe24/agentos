import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import { Separator } from '@agentos/ui/components/separator';

import { FilesBrowser } from './files-browser';
import { FilesDetail } from './files-detail';
import {
  encodeBlobPath,
  fileToBase64,
  joinPrefix,
  parseErrorBody,
  parseListResponse,
  type FilesBlobJson,
  type FilesListItem,
  type FilesViewMode,
  type UploadProgressItem,
} from './files-types';
import { useFilesPrefix } from './use-files-prefix';

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

  const [items, setItems] = useState<FilesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [viewMode, setViewMode] = useState<FilesViewMode>('grid');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>(
    [],
  );

  const [previewBlob, setPreviewBlob] = useState<FilesBlobJson | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const selectedItems = useMemo(
    () => items.filter((i) => selectedKeys.has(i.key)),
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
    params.set('prefix', prefix);
    params.set('limit', '100');
    if (activeSearch) params.set('q', activeSearch);

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
  }, [activeSearch, api, prefix]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    revokePreviewUrl();
    setPreviewBlob(null);
    setPreviewError(null);

    if (!primary || primary.kind !== 'file') {
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setPreviewLoading(true);
      const path = encodeBlobPath(primary.relativeKey);
      const res = await api.fetch(`/blobs/${path}?format=json`);
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
  }, [api, primary, revokePreviewUrl]);

  async function downloadItem(item: FilesListItem) {
    if (item.kind === 'folder') return;
    const path = encodeBlobPath(item.relativeKey);
    const res = await api.fetch(`/blobs/${path}?format=json`);
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
    if (unauthenticated) return;
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
        const base64 = await fileToBase64(file);
        const key = joinPrefix(prefix, file.name);
        const path = encodeBlobPath(key);
        const res = await api.fetch(`/blobs/${path}`, {
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
          `/blobs?prefix=${encodeURIComponent(folderPrefix)}`,
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
        const res = await api.fetch(`/blobs/${path}`, { method: 'DELETE' });
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
    await notifications.show('Deleted selected items', 'info');
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
        body: JSON.stringify({ from, to }),
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

  const disabled = unauthenticated;

  return (
    <div
      className="flex h-full min-h-full flex-col gap-4 bg-background p-6 text-foreground"
      data-slot="files-page"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted-foreground">
          Org-scoped storage — upload, preview, and manage blobs.
        </p>
      </header>
      <Separator />
      {unauthenticated ? (
        <p className="text-sm text-destructive" role="alert">
          You are not signed in. Open{' '}
          <span className="font-medium">/login</span> to access org files.
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <FilesBrowser
          prefix={prefix}
          items={items}
          loading={loading}
          error={error}
          searchQuery={searchQuery}
          viewMode={viewMode}
          selectedKeys={selectedKeys}
          disabled={disabled}
          upload={{ progress: uploadProgress, onUploadFiles }}
          onSearchQueryChange={setSearchQuery}
          onSearchSubmit={() => setActiveSearch(searchQuery.trim())}
          onClearSearch={() => {
            setSearchQuery('');
            setActiveSearch('');
          }}
          onViewModeChange={setViewMode}
          onPrefixChange={(next) => void setPrefix(next)}
          onOpenItem={(item) => {
            if (item.kind === 'folder') {
              void setPrefix(folderPrefixFor(item));
              setSelectedKeys(new Set());
              return;
            }
            setSelectedKeys(new Set([item.key]));
          }}
          onToggleSelect={(item) => {
            setSelectedKeys((prev) => {
              const next = new Set(prev);
              if (next.has(item.key)) next.delete(item.key);
              else next.add(item.key);
              return next;
            });
          }}
          onSelectAll={() => setSelectedKeys(new Set(items.map((i) => i.key)))}
          onClearSelection={() => setSelectedKeys(new Set())}
          onDownloadSelected={() => {
            void (async () => {
              for (const item of selectedItems.filter(
                (i) => i.kind === 'file',
              )) {
                await downloadItem(item);
              }
            })();
          }}
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
        />
        <FilesDetail
          selection={selectedItems}
          primary={primary}
          blob={previewBlob}
          blobUrl={previewUrl}
          previewLoading={previewLoading}
          previewError={previewError}
          onDownload={downloadItem}
        />
      </div>
    </div>
  );
}
