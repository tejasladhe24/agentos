import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useHostApi,
  useHostNavigation,
  useHostNotifications,
  useHostUi,
} from '@agentos/core/client';

import { FilesDetail } from './files-detail';
import {
  encodeBlobPath,
  exportQuery,
  FILES_DETAIL_OPEN_CHANNEL,
  mountQuery,
  parseErrorBody,
  PLATFORM_MOUNT_ID,
  resolveSelectedMount,
  type FilesBlobJson,
  type FilesListItem,
} from './files-types';
import { driveCopy } from './personal-drives';
import { useFilesMount } from './use-files-mount';
import { useFilesMounts } from './use-files-mounts';
import { useFilesSelection } from './use-files-selection';

/**
 * Files right sidebar contribution (`ui/right-sidebar.tsx`) —
 * renders metadata, actions, and preview for the active Files selection.
 */
export default function FilesRightSidebar() {
  const api = useHostApi();
  const navigation = useHostNavigation();
  const notifications = useHostNotifications();
  const ui = useHostUi();
  const [selection] = useFilesSelection();
  const [selectedMountId] = useFilesMount();
  const { data: mountsData } = useFilesMounts();
  const mounts = mountsData.mounts;
  const mount = resolveSelectedMount(mounts, selectedMountId);
  const mountId = mount?.id ?? PLATFORM_MOUNT_ID;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<FilesBlobJson | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const primary = selection.length === 1 ? (selection[0] ?? null) : null;

  const mountOf = useCallback(
    (item: FilesListItem) => item.mountId ?? mountId,
    [mountId],
  );

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void ui.isRightSidebarOpen().then((open) => {
      if (!cancelled) setPanelVisible(open);
    });

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(FILES_DETAIL_OPEN_CHANNEL)
        : null;
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'boolean') {
          setPanelVisible(event.data);
        }
      };
    }

    const el = rootRef.current;
    const observer =
      el && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            const visible = entries.some((entry) => entry.isIntersecting);
            setPanelVisible(visible);
          })
        : null;
    if (observer && el) observer.observe(el);

    return () => {
      cancelled = true;
      channel?.close();
      observer?.disconnect();
    };
  }, [ui]);

  useEffect(() => {
    revokePreviewUrl();
    setPreviewBlob(null);
    setPreviewError(null);

    if (!panelVisible || !primary || primary.kind !== 'file') {
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setPreviewLoading(true);
      const path = encodeBlobPath(primary.relativeKey);
      const previewFormat = primary.exportFormats?.includes('pdf')
        ? 'pdf'
        : undefined;
      const res = await api.fetch(
        `/blobs/${path}?format=json${mountQuery(mountOf(primary), '&')}${exportQuery(primary, previewFormat)}`,
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
  }, [api, mountOf, panelVisible, primary, revokePreviewUrl]);

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

  function closeDetail() {
    setPanelVisible(false);
    void ui.setRightSidebarOpen(false);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(FILES_DETAIL_OPEN_CHANNEL);
      channel.postMessage(false);
      channel.close();
    }
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-slot="files-right-sidebar"
    >
      <FilesDetail
        open
        selection={selection}
        primary={primary}
        blob={previewBlob}
        blobUrl={previewUrl}
        previewLoading={previewLoading}
        previewError={previewError}
        onDownload={(item, format) => void downloadItem(item, format)}
        onOpenExternal={(url) =>
          void navigation.openExternal(url).catch(() => undefined)
        }
        openInLabel={
          driveCopy(mounts.find((m) => m.id === primary?.mountId)?.provider).app
        }
        onClose={closeDetail}
      />
    </div>
  );
}
