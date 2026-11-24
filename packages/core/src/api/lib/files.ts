/**
 * @agentos/core/api/files — HTTP client for builtin `files` (tickets 23, 96, 110).
 *
 * Keys may be legacy org keys (`docs/a.txt`, `orgs/<orgId>/docs/a.txt` →
 * platform mount) or canonical references `files://<mountId>/<path>`.
 */

import { jsonFetch, resolveExtApiBase, type EnvMap } from './http';

export {
  DEFAULT_MOUNT_ALIAS,
  FILES_REF_SCHEME,
  PLATFORM_MOUNT_ID,
  formatFileRef,
  isFileRef,
  orgIdFromLegacyKey,
  parseFileRef,
  toFileRef,
  type FileRef,
} from './files-ref';

/** Resolve builtin files API base (`…/api/ext/files` or test override). */
export function resolveFilesApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('files', 'AGENT_OS_FILES_API_BASE', env);
}

/** Trusted peer / FDE header for active org (matches files + db-store). */
export const FILES_ORG_ID_HEADER = 'x-agentos-org-id';

export type PutBlobResult = {
  ok: true;
  /** Storage key within the mount (legacy `orgs/<orgId>/…` for platform). */
  key: string;
  /** Canonical `files://<mountId>/<path>` reference. */
  ref?: string;
  mountId?: string;
  bytes: number;
  contentType?: string;
};

export type GetBlobBase64Result = {
  key: string;
  ref?: string;
  mountId?: string;
  base64: string;
  bytes: number;
  contentType?: string;
  updatedAt?: string;
};

export type DeleteBlobResult = { ok: true; key: string; ref?: string };

export type FilesListItem = {
  key: string;
  name: string;
  kind: 'file' | 'folder';
  bytes?: number;
  contentType?: string;
  updatedAt?: string;
  relativeKey: string;
  mountId?: string;
  ref?: string;
};

export type ListBlobsResult = {
  items: FilesListItem[];
  cursor: string | null;
  prefix: string;
  q?: string;
  mountId?: string;
};

export type MoveBlobResult = {
  ok: true;
  from?: string;
  to?: string;
  fromRef?: string;
  toRef?: string;
  moved?: string[];
  copied?: string[];
  refs?: string[];
  total?: number;
};

export type CopyBlobResult = MoveBlobResult;

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
  isDefault: boolean;
  status: 'connected' | 'disconnected' | 'error';
  statusMessage?: string;
  builtin?: boolean;
  config?: Record<string, unknown>;
  capabilities?: StorageCapabilities;
  indexMode?: 'indexed' | 'live';
  usage?: { files: number; bytes: number };
};

export type ListMountsResult = {
  mounts: FilesMount[];
  defaultMountId: string;
  providers: Array<{
    id: string;
    label: string;
    icon?: string;
    orgAddable: boolean;
    personal: boolean;
  }>;
  canManage: boolean;
};

/** Cross-mount options for move / copy (refs in from/to take precedence). */
export type TransferOptions = {
  fromMount?: string;
  toMount?: string;
};

export type FilesCallInit = {
  /** Forward cookie / auth headers from the inbound FDE request. */
  headers?: HeadersInit;
  /** Active org id sent as `X-AgentOS-Org-Id` (peer / service path). */
  orgId?: string;
  /** Optional content-type for PUT (JSON body or x-agentos-content-type). */
  contentType?: string;
  /**
   * Target mount for plain keys (`default` = org default upload mount).
   * Ignored when the key is a `files://` reference.
   */
  mountId?: string;
};

function blobUrl(base: string, key: string, init?: FilesCallInit): string {
  const url = `${base}/blobs/${encodeURIComponent(key)}`;
  return init?.mountId
    ? `${url}?mount=${encodeURIComponent(init.mountId)}`
    : url;
}

function withQuery(url: string, query: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

function filesHeaders(init?: FilesCallInit): Headers {
  const headers = new Headers(init?.headers);
  if (init?.orgId) {
    headers.set(FILES_ORG_ID_HEADER, init.orgId);
  }
  return headers;
}

/** Put raw bytes (octet-stream) or base64 JSON body. */
export async function putBlob(
  key: string,
  data: Uint8Array | string,
  env?: EnvMap,
  init?: FilesCallInit,
): Promise<PutBlobResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  const url = blobUrl(base, key, init);
  const headers = filesHeaders(init);

  if (typeof data === 'string') {
    const body: Record<string, string> = { base64: data };
    if (init?.contentType) body.contentType = init.contentType;
    return jsonFetch<PutBlobResult>(
      url,
      { method: 'PUT', body, headers },
      'files putBlob',
    );
  }

  headers.set('content-type', init?.contentType || 'application/octet-stream');
  if (init?.contentType) {
    headers.set('x-agentos-content-type', init.contentType);
  }
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: data,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `files putBlob failed (${res.status}): ${detail || res.statusText}`,
    );
  }
  return (await res.json()) as PutBlobResult;
}

/** Get blob as raw bytes. */
export async function getBlob(
  key: string,
  env?: EnvMap,
  init?: FilesCallInit,
): Promise<Uint8Array> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  const res = await fetch(blobUrl(base, key, init), {
    method: 'GET',
    headers: filesHeaders(init),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(
      `files getBlob failed (${res.status}): ${detail || res.statusText}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Get blob as base64 JSON (`?format=json`). */
export async function getBlobBase64(
  key: string,
  env?: EnvMap,
  init?: FilesCallInit,
): Promise<GetBlobBase64Result> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return jsonFetch<GetBlobBase64Result>(
    withQuery(blobUrl(base, key, init), 'format=json'),
    { method: 'GET', headers: filesHeaders(init) },
    'files getBlobBase64',
  );
}

/** Delete a blob by key (idempotent when missing). */
export async function deleteBlob(
  key: string,
  env?: EnvMap,
  init?: FilesCallInit,
): Promise<DeleteBlobResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return jsonFetch<DeleteBlobResult>(
    blobUrl(base, key, init),
    { method: 'DELETE', allowEmpty: false, headers: filesHeaders(init) },
    'files deleteBlob',
  );
}

/** List blobs / virtual folders under a prefix (org-scoped). */
export async function listBlobs(
  options: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    q?: string;
    /** Mount to browse (default platform); `view` spans all mounts. */
    mountId?: string;
    view?: 'files' | 'bin' | 'storage';
  } = {},
  env?: EnvMap,
  init?: FilesCallInit,
): Promise<ListBlobsResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  const params = new URLSearchParams();
  if (options.prefix) params.set('prefix', options.prefix);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.q) params.set('q', options.q);
  if (options.mountId) params.set('mount', options.mountId);
  if (options.view) params.set('view', options.view);
  const qs = params.toString();
  return jsonFetch<ListBlobsResult>(
    `${base}/blobs${qs ? `?${qs}` : ''}`,
    { method: 'GET', headers: filesHeaders(init) },
    'files listBlobs',
  );
}

function transferBody(
  from: string,
  to: string,
  init?: FilesCallInit & TransferOptions,
): Record<string, string> {
  const body: Record<string, string> = { from, to };
  if (init?.mountId) body.mount = init.mountId;
  if (init?.fromMount) body.fromMount = init.fromMount;
  if (init?.toMount) body.toMount = init.toMount;
  return body;
}

/** Move/rename a file or folder prefix (within or across mounts). */
export async function moveBlob(
  from: string,
  to: string,
  env?: EnvMap,
  init?: FilesCallInit & TransferOptions,
): Promise<MoveBlobResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return jsonFetch<MoveBlobResult>(
    `${base}/blobs/move`,
    {
      method: 'POST',
      body: transferBody(from, to, init),
      headers: filesHeaders(init),
    },
    'files moveBlob',
  );
}

/**
 * Copy a file or folder prefix. Across mounts this streams bytes (e.g.
 * sharing a personal-drive file into an org mount).
 */
export async function copyBlob(
  from: string,
  to: string,
  env?: EnvMap,
  init?: FilesCallInit & TransferOptions,
): Promise<CopyBlobResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return jsonFetch<CopyBlobResult>(
    `${base}/blobs/copy`,
    {
      method: 'POST',
      body: transferBody(from, to, init),
      headers: filesHeaders(init),
    },
    'files copyBlob',
  );
}

/** Mounts visible to the caller (platform first) + default upload mount. */
export async function listMounts(
  env?: EnvMap,
  init?: FilesCallInit & { usage?: boolean },
): Promise<ListMountsResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return jsonFetch<ListMountsResult>(
    `${base}/mounts${init?.usage ? '?usage=1' : ''}`,
    { method: 'GET', headers: filesHeaders(init) },
    'files listMounts',
  );
}
