import { BlobStoreError, type BlobStore } from './blob-store';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function parseBlobPath(path: string): string | null {
  const match = path.match(/^\/blobs\/(.+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * Thin Bun request router for `/api/ext/files/*` upstream paths.
 */
export async function handleFilesRequest(
  store: BlobStore,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({
      ok: true,
      backend: store.backend,
      label: store.label,
    });
  }

  const key = parseBlobPath(path);
  if (!key) {
    return json({ error: 'not found' }, { status: 404 });
  }

  try {
    if (method === 'PUT') {
      const contentType = request.headers.get('content-type') ?? '';
      let bytes: Uint8Array;
      if (contentType.includes('application/json')) {
        const body = (await request.json()) as {
          data?: string;
          base64?: string;
        };
        const b64 =
          typeof body.base64 === 'string'
            ? body.base64
            : typeof body.data === 'string'
              ? body.data
              : null;
        if (!b64) {
          return json(
            { error: 'base64 (or data) required in JSON body' },
            { status: 400 },
          );
        }
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } else {
        bytes = new Uint8Array(await request.arrayBuffer());
      }
      await store.put(key, bytes);
      return json({ ok: true, key, bytes: bytes.byteLength });
    }

    if (method === 'GET') {
      const bytes = await store.get(key);
      if (!bytes) {
        return json({ error: 'not found' }, { status: 404 });
      }
      const asJson = url.searchParams.get('format') === 'json';
      if (asJson) {
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return json({
          key,
          base64: btoa(binary),
          bytes: bytes.byteLength,
        });
      }
      return new Response(bytes, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.byteLength),
        },
      });
    }

    if (method === 'DELETE') {
      await store.delete(key);
      return json({ ok: true, key });
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  } catch (error) {
    if (error instanceof BlobStoreError) {
      return json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
