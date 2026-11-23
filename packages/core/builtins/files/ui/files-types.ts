export type FilesItemKind = 'file' | 'folder';

export type FilesListItem = {
  key: string;
  name: string;
  kind: FilesItemKind;
  bytes?: number;
  contentType?: string;
  updatedAt?: string;
  relativeKey: string;
};

export type FilesListResponse = {
  items: FilesListItem[];
  cursor: string | null;
  prefix: string;
  q?: string;
};

export type FilesViewMode = 'grid' | 'list';

export type FilesBlobJson = {
  key: string;
  base64: string;
  bytes: number;
  contentType: string;
  updatedAt?: string;
};

export type UploadProgressItem = {
  id: string;
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
};

export const FILES_PREFIX_STORAGE_KEY = 'files:prefix';
export const FILES_PREFIX_CHANNEL = 'agentos-files-prefix';

export function parseErrorBody(body: string, fallback: string): string {
  try {
    const data = JSON.parse(body) as { error?: string; message?: string };
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
  } catch {
    // ignore
  }
  return body.trim() || fallback;
}

export function parseListResponse(body: string): FilesListResponse {
  const data = JSON.parse(body) as Partial<FilesListResponse>;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    cursor: data.cursor ?? null,
    prefix: typeof data.prefix === 'string' ? data.prefix : '',
    q: typeof data.q === 'string' ? data.q : undefined,
  };
}

export function formatBytes(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function breadcrumbSegments(
  prefix: string,
): { label: string; prefix: string }[] {
  const trimmed = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments: { label: string; prefix: string }[] = [
    { label: 'My files', prefix: '' },
  ];
  if (!trimmed) return segments;
  const parts = trimmed.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    segments.push({ label: part, prefix: `${acc}/` });
  }
  return segments;
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function joinPrefix(prefix: string, name: string): string {
  const base = prefix.replace(/\/+$/, '');
  const clean = name.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!base) return clean;
  return `${base}/${clean}`;
}

export function encodeBlobPath(relativeKey: string): string {
  return relativeKey
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export function isImageContentType(contentType?: string): boolean {
  return Boolean(contentType?.startsWith('image/'));
}

export function isPdfContentType(contentType?: string): boolean {
  return contentType === 'application/pdf';
}
