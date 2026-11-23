/**
 * @agentos/core/api/files — HTTP client for builtin `files` (tickets 23, 96).
 */

import { jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin files API base (`…/api/ext/files` or test override). */
export function resolveFilesApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('files', 'AGENT_OS_FILES_API_BASE', env);
}

/** Trusted peer / FDE header for active org (matches files + db-store). */
export const FILES_ORG_ID_HEADER = 'x-agentos-org-id';

export type PutBlobResult = {
  ok: true;
  key: string;
  bytes: number;
  contentType?: string;
};

export type GetBlobBase64Result = {
  key: string;
  base64: string;
  bytes: number;
  contentType?: string;
  updatedAt?: string;
};

export type DeleteBlobResult = { ok: true; key: string };

export type FilesListItem = {
  key: string;
  name: string;
  kind: 'file' | 'folder';
  bytes?: number;
  contentType?: string;
  updatedAt?: string;
  relativeKey: string;
};

export type ListBlobsResult = {
  items: FilesListItem[];
  cursor: string | null;
  prefix: string;
  q?: string;
};

export type MoveBlobResult = {
  ok: true;
  from?: string;
  to?: string;
  moved?: string[];
};

export type FilesCallInit = {
  /** Forward cookie / auth headers from the inbound FDE request. */
  headers?: HeadersInit;
  /** Active org id sent as `X-AgentOS-Org-Id` (peer / service path). */
  orgId?: string;
  /** Optional content-type for PUT (JSON body or x-agentos-content-type). */
  contentType?: string;
};

function blobUrl(base: string, key: string): string {
  return `${base}/blobs/${encodeURIComponent(key)}`;
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
  const url = blobUrl(base, key);
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
  const res = await fetch(blobUrl(base, key), {
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
    `${blobUrl(base, key)}?format=json`,
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
    blobUrl(base, key),
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
  const qs = params.toString();
  return jsonFetch<ListBlobsResult>(
    `${base}/blobs${qs ? `?${qs}` : ''}`,
    { method: 'GET', headers: filesHeaders(init) },
    'files listBlobs',
  );
}

/** Move/rename a file or folder prefix. */
export async function moveBlob(
  from: string,
  to: string,
  env?: EnvMap,
  init?: FilesCallInit,
): Promise<MoveBlobResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return jsonFetch<MoveBlobResult>(
    `${base}/blobs/move`,
    {
      method: 'POST',
      body: { from, to },
      headers: filesHeaders(init),
    },
    'files moveBlob',
  );
}
