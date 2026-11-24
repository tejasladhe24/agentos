import {
  ALLOWED_ATTACHMENT_MEDIA_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_TOTAL_BYTES,
} from './constants';
import { isFileRef, orgIdFromLegacyKey } from '@agentos/core/api/files-ref';

import type { FetchLike } from './fetch-like';

export type AttachmentInput = {
  /** Legacy files key or `files://<mountId>/<path>` reference. */
  key?: string;
  /** Alias of `key` for `files://` references. */
  ref?: string;
  base64?: string;
  mediaType?: string;
};

/** Caller context forwarded to the files builtin for `files://` refs. */
export type AttachmentAuth = {
  orgId?: string;
  cookie?: string;
};

export type ResolvedAttachment = {
  mediaType: string;
  data: Uint8Array;
};

export type ResolveAttachmentsError = {
  status: 400;
  error: string;
};

function normalizeMediaType(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (lower === 'image/jpg') return 'image/jpeg';
  return lower;
}

function isAllowedMediaType(mediaType: string): boolean {
  return ALLOWED_ATTACHMENT_MEDIA_TYPES.has(mediaType);
}

function decodeBase64(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Org header / session cookie from the inbound AI request. */
export function attachmentAuth(request: Request): AttachmentAuth {
  const auth: AttachmentAuth = {};
  const orgId = request.headers.get('x-agentos-org-id')?.trim();
  if (orgId) auth.orgId = orgId;
  const cookie = request.headers.get('cookie');
  if (cookie) auth.cookie = cookie;
  return auth;
}

function filesHeaders(
  key: string,
  auth: AttachmentAuth | undefined,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  const orgId = isFileRef(key)
    ? auth?.orgId
    : (orgIdFromLegacyKey(key) ?? auth?.orgId);
  if (orgId) headers['x-agentos-org-id'] = orgId;
  if (auth?.cookie) headers.cookie = auth.cookie;
  return Object.keys(headers).length ? headers : undefined;
}

async function fetchBlobByKey(
  gatewayUrl: string,
  key: string,
  fetchImpl: FetchLike,
  auth?: AttachmentAuth,
): Promise<{ base64: string; bytes: number } | ResolveAttachmentsError> {
  const base = gatewayUrl.replace(/\/+$/, '');
  const url = `${base}/api/ext/files/blobs/${encodeURIComponent(key)}?format=json`;
  const headers = filesHeaders(key, auth);
  const res = await fetchImpl(url, headers ? { headers } : undefined);
  if (!res.ok) {
    return {
      status: 400,
      error: `files key not found or unreadable (${res.status}): ${key}`,
    };
  }
  const body = (await res.json()) as {
    base64?: string;
    bytes?: number;
  };
  if (typeof body.base64 !== 'string') {
    return { status: 400, error: `files key returned no base64: ${key}` };
  }
  return {
    base64: body.base64,
    bytes: typeof body.bytes === 'number' ? body.bytes : body.base64.length,
  };
}

/**
 * Resolve optional `files` on generate requests into AI SDK file parts.
 * Accepts files-builtin keys, `files://` references (resolved with the
 * caller's org / cookie), or inline base64 with size / MIME limits.
 */
export async function resolveAttachments(
  files: unknown,
  gatewayUrl: string,
  fetchImpl: FetchLike = fetch,
  auth?: AttachmentAuth,
): Promise<ResolvedAttachment[] | ResolveAttachmentsError> {
  if (files === undefined || files === null) {
    return [];
  }
  if (!Array.isArray(files)) {
    return { status: 400, error: 'files must be an array' };
  }
  if (files.length > MAX_ATTACHMENTS) {
    return {
      status: 400,
      error: `too many files (max ${MAX_ATTACHMENTS})`,
    };
  }

  const resolved: ResolvedAttachment[] = [];
  let totalBytes = 0;

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { status: 400, error: `files[${i}] must be an object` };
    }
    const entry = item as AttachmentInput;
    const mediaTypeRaw =
      typeof entry.mediaType === 'string' ? entry.mediaType : '';
    if (!mediaTypeRaw) {
      return { status: 400, error: `files[${i}].mediaType required` };
    }
    const mediaType = normalizeMediaType(mediaTypeRaw);
    if (!isAllowedMediaType(mediaType)) {
      return {
        status: 400,
        error: `files[${i}].mediaType not allowed: ${mediaType}`,
      };
    }

    const blobKey =
      typeof entry.key === 'string' && entry.key.length > 0
        ? entry.key
        : typeof entry.ref === 'string' && entry.ref.length > 0
          ? entry.ref
          : undefined;
    const hasKey = blobKey !== undefined;
    const hasBase64 =
      typeof entry.base64 === 'string' && entry.base64.length > 0;
    if (hasKey === hasBase64) {
      return {
        status: 400,
        error: `files[${i}] requires exactly one of key (or ref) or base64`,
      };
    }

    let base64: string;
    if (hasKey) {
      const fetched = await fetchBlobByKey(
        gatewayUrl,
        blobKey!,
        fetchImpl,
        auth,
      );
      if ('error' in fetched) return fetched;
      base64 = fetched.base64;
    } else {
      base64 = entry.base64!;
    }

    const data = decodeBase64(base64);
    if (!data) {
      return { status: 400, error: `files[${i}] invalid base64` };
    }
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      return {
        status: 400,
        error: `files[${i}] exceeds ${MAX_ATTACHMENT_BYTES} bytes`,
      };
    }
    totalBytes += data.byteLength;
    if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
      return {
        status: 400,
        error: `files total exceeds ${MAX_ATTACHMENTS_TOTAL_BYTES} bytes`,
      };
    }

    resolved.push({ mediaType, data });
  }

  return resolved;
}

export function isResolveAttachmentsError(
  value: ResolvedAttachment[] | ResolveAttachmentsError,
): value is ResolveAttachmentsError {
  return !Array.isArray(value);
}
