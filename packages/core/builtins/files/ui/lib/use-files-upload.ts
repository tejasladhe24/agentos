import { useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';

import {
  encodeBlobPath,
  fileToBase64,
  formatBytes,
  joinPrefix,
  mountQuery,
  parseErrorBody,
  type FilesMount,
  type UploadProgressItem,
} from './files-types';

/** Sequential uploads into the current prefix with per-file progress. */
export function useFilesUpload({
  enabled,
  mount,
  mountId,
  prefix,
  reload,
}: {
  /** False when signed out or outside the Drive section. */
  enabled: boolean;
  mount?: FilesMount;
  mountId: string;
  prefix: string;
  reload: () => Promise<void>;
}) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [uploadProgress, setUploadProgress] = useState<UploadProgressItem[]>(
    [],
  );

  async function onUploadFiles(files: File[]) {
    if (!enabled) return;
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

    await reload();
    setTimeout(() => setUploadProgress([]), 4000);
  }

  return { uploadProgress, onUploadFiles };
}
