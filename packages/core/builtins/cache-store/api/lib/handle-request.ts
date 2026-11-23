import { CacheError, type CacheBackend } from './create-cache';

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function requireKey(body: Record<string, unknown> | null): string | null {
  const key = typeof body?.key === 'string' ? body.key : '';
  return key.length > 0 ? key : null;
}

/**
 * Thin Bun request router for `/api/ext/cache-store/*` upstream paths.
 */
export async function handleCacheStoreRequest(
  cache: CacheBackend,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({ ok: true, backend: cache.backend });
  }

  if (method !== 'POST') {
    return json({ error: 'not found' }, { status: 404 });
  }

  try {
    switch (path) {
      case '/get': {
        const body = await readJsonBody(request);
        const key = requireKey(body);
        if (!key) {
          return json({ error: 'key required' }, { status: 400 });
        }
        const value = await cache.get(key);
        if (value === undefined) {
          return json({ error: 'not found' }, { status: 404 });
        }
        return json({ key, value });
      }
      case '/set': {
        const body = await readJsonBody(request);
        const key = requireKey(body);
        if (!key) {
          return json({ error: 'key required' }, { status: 400 });
        }
        if (!body || !('value' in body)) {
          return json({ error: 'value required' }, { status: 400 });
        }
        const ttl =
          typeof body.ttl === 'number' && Number.isFinite(body.ttl)
            ? body.ttl
            : body.ttl === undefined
              ? undefined
              : null;
        if (ttl === null) {
          return json(
            { error: 'ttl must be a positive number of seconds' },
            { status: 400 },
          );
        }
        await cache.set(key, body.value, ttl);
        return json({ ok: true });
      }
      case '/del': {
        const body = (await readJsonBody(request)) ?? {};
        const keys: string[] = [];
        if (typeof body.key === 'string' && body.key.length > 0) {
          keys.push(body.key);
        }
        if (Array.isArray(body.keys)) {
          for (const k of body.keys) {
            if (typeof k === 'string' && k.length > 0) keys.push(k);
          }
        }
        if (keys.length === 0) {
          return json({ error: 'key or keys required' }, { status: 400 });
        }
        return json({ deleted: await cache.del(keys) });
      }
      case '/ttl': {
        const body = await readJsonBody(request);
        const key = requireKey(body);
        if (!key) {
          return json({ error: 'key required' }, { status: 400 });
        }
        if ((await cache.get(key)) === undefined) {
          return json({ key, ttl: null });
        }
        return json({ key, ttl: await cache.ttl(key) });
      }
      default:
        return json({ error: 'not found' }, { status: 404 });
    }
  } catch (error) {
    if (error instanceof CacheError) {
      return json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
