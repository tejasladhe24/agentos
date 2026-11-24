import { BlobStoreError } from './blob-store-error';
import { MountUnavailableError } from './mounts';

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function readJson<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
}

/** Map known storage errors to JSON responses; rethrow anything else. */
export function errorResponse(error: unknown): Response {
  if (error instanceof BlobStoreError) {
    return json({ error: error.message }, { status: error.status });
  }
  if (error instanceof MountUnavailableError) {
    return json({ error: error.message }, { status: error.status });
  }
  throw error;
}
