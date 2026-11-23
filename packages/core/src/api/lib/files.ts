/**
 * @agentos/core/api/files — HTTP client for builtin `files` (ticket 23).
 */

import { getJson, jsonFetch, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin files API base (`…/api/ext/files` or test override). */
export function resolveFilesApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('files', 'AGENT_OS_FILES_API_BASE', env);
}

export type PutBlobResult = { ok: true; key: string; bytes: number };

export type GetBlobBase64Result = {
  key: string;
  base64: string;
  bytes: number;
};

function blobUrl(base: string, key: string): string {
  return `${base}/blobs/${encodeURIComponent(key)}`;
}

/** Put raw bytes (octet-stream) or base64 JSON body. */
export async function putBlob(
  key: string,
  data: Uint8Array | string,
  env?: EnvMap,
): Promise<PutBlobResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  const url = blobUrl(base, key);

  if (typeof data === 'string') {
    return jsonFetch<PutBlobResult>(
      url,
      { method: 'PUT', body: { base64: data } },
      'files putBlob',
    );
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
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
export async function getBlob(key: string, env?: EnvMap): Promise<Uint8Array> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  const res = await fetch(blobUrl(base, key), { method: 'GET' });
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
): Promise<GetBlobBase64Result> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return getJson<GetBlobBase64Result>(
    `${blobUrl(base, key)}?format=json`,
    'files getBlobBase64',
  );
}

export type DeleteBlobResult = { ok: true; key: string };

/** Delete a blob by key (idempotent when missing). */
export async function deleteBlob(
  key: string,
  env?: EnvMap,
): Promise<DeleteBlobResult> {
  const base = resolveFilesApiBase(env ?? Bun.env);
  return jsonFetch<DeleteBlobResult>(
    blobUrl(base, key),
    { method: 'DELETE', allowEmpty: false },
    'files deleteBlob',
  );
}
