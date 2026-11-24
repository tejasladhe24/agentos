export type FilesItemKind = 'file' | 'folder';

export type FilesListItem = {
  key: string;
  name: string;
  kind: FilesItemKind;
  bytes?: number;
  contentType?: string;
  updatedAt?: string;
  relativeKey: string;
  /** Owning mount (absent on responses from older servers → platform). */
  mountId?: string;
  /** Canonical `files://<mountId>/<path>` reference. */
  ref?: string;
  /** Mount display name on cross-mount views (Bin / Storage). */
  mountName?: string;
  trashedAt?: string;
  purgeAt?: string | null;
  originalKey?: string;
  /** Open in the provider's own app (live drives). */
  webUrl?: string;
  /** Provider-native document (Google Docs…) — export formats. */
  exportFormats?: string[];
};

export type StorageCapabilities = {
  serverSideCopy: boolean;
  nativeFolders: boolean;
  nativeTrash: boolean;
  versions: boolean;
  maxFileSize: number;
  exportFormats: string[];
  quota: boolean;
};

export type FilesMount = {
  id: string;
  kind: 'org' | 'personal';
  ownerUserId?: string;
  provider: string;
  name: string;
  config?: Record<string, unknown>;
  isDefault: boolean;
  status: 'connected' | 'disconnected' | 'error';
  statusMessage?: string;
  builtin?: boolean;
  capabilities?: StorageCapabilities;
  indexMode?: 'indexed' | 'live';
  usage?: { files: number; bytes: number };
  /** Provider quota (live drives). */
  quota?: { usedBytes: number; limitBytes?: number };
};

export type StorageProviderField = {
  id: string;
  label: string;
  type: 'text' | 'secret' | 'choice';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  help?: string;
};

export type StorageProviderPreset = {
  id: string;
  label: string;
  help?: string;
  fields?: string[];
  required?: string[];
};

export type StorageProviderInfo = {
  id: string;
  label: string;
  icon?: string;
  orgAddable: boolean;
  personal: boolean;
  /** Personal provider whose platform OAuth app is configured. */
  connectable?: boolean;
  fields?: StorageProviderField[];
  presets?: StorageProviderPreset[];
};

export type FilesMountsResponse = {
  mounts: FilesMount[];
  defaultMountId: string;
  providers: StorageProviderInfo[];
  canManage: boolean;
};

export const PLATFORM_MOUNT_ID = 'platform';

export const FILES_MOUNT_STORAGE_KEY = 'files:mount';
export const FILES_MOUNT_CHANNEL = 'agentos-files-mount';
/** Broadcast after mounts change (Settings) so the sidebar reloads. */
export const FILES_MOUNTS_CHANGED_CHANNEL = 'agentos-files-mounts-changed';

export function parseMountsResponse(body: string): FilesMountsResponse {
  const data = JSON.parse(body) as Partial<FilesMountsResponse>;
  return {
    mounts: Array.isArray(data.mounts) ? data.mounts : [],
    defaultMountId:
      typeof data.defaultMountId === 'string'
        ? data.defaultMountId
        : PLATFORM_MOUNT_ID,
    providers: Array.isArray(data.providers) ? data.providers : [],
    canManage: data.canManage === true,
  };
}

/** Selected mount, else the org default (new uploads), else platform. */
export function resolveSelectedMount(
  mounts: FilesMount[],
  selectedId: string,
): FilesMount | undefined {
  return (
    (selectedId ? mounts.find((m) => m.id === selectedId) : undefined) ??
    mounts.find((m) => m.isDefault) ??
    mounts.find((m) => m.id === PLATFORM_MOUNT_ID)
  );
}

/** Stable selection id across mounts (refs are unique; keys may collide). */
export function itemId(item: Pick<FilesListItem, 'key' | 'ref'>): string {
  return item.ref ?? item.key;
}

/** `?mount=` query fragment for blob routes (omitted for platform). */
export function mountQuery(mountId: string, leading: '?' | '&' = '?'): string {
  if (!mountId || mountId === PLATFORM_MOUNT_ID) return '';
  return `${leading}mount=${encodeURIComponent(mountId)}`;
}

export type FilesListResponse = {
  items: FilesListItem[];
  cursor: string | null;
  prefix: string;
  q?: string;
  view?: FilesSection;
};

export type FilesViewMode = 'grid' | 'list';

/** Left-nav sections in the Files extension. */
export type FilesSection = 'files' | 'bin' | 'storage';

export type BinRetentionDays = 15 | 30 | null;

export type FilesOrgSettings = {
  binRetentionDays: BinRetentionDays;
};

export type FilesBlobJson = {
  key: string;
  base64: string;
  bytes: number;
  contentType: string;
  /** Download name (exports carry their extension). */
  name?: string;
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

export const FILES_SECTION_STORAGE_KEY = 'files:section';
export const FILES_SECTION_CHANNEL = 'agentos-files-section';

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

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Format as `DD MMM YYYY, HH:MM:SS` (local time). */
export function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const dd = String(d.getDate()).padStart(2, '0');
    const mmm = MONTHS_SHORT[d.getMonth()]!;
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd} ${mmm} ${yyyy}, ${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}

export function breadcrumbSegments(
  prefix: string,
  rootLabel = 'Files',
): { label: string; prefix: string }[] {
  const trimmed = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  const segments: { label: string; prefix: string }[] = [
    { label: rootLabel, prefix: '' },
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
