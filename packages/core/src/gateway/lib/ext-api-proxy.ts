import type { ExtensionEnableState } from './enable-state';
import { plainResponse } from './http';
import type {
  GatewayHandler,
  ProxyFetch,
  RegistryModel,
  ScannedExtension,
} from './types';

/** Gateway prefix for extension API reverse-proxy. */
export const EXT_API_PREFIX = '/api/ext';

export type ParsedExtApiPath = {
  extensionId: string;
  /** Path forwarded to upstream (starts with `/`, or `/` when empty). */
  targetPath: string;
  /** Includes leading `?` when present; otherwise empty. */
  search: string;
};

const EXT_API_PATH_RE = /^\/api\/ext\/([^/]+)(\/.*)?$/;

/** Parse `/api/ext/:id/*` (+ query) into id, upstream path, and search. */
export function parseExtApiPath(url: string): ParsedExtApiPath | null {
  const qIndex = url.indexOf('?');
  const pathname = qIndex === -1 ? url : url.slice(0, qIndex);
  const search = qIndex === -1 ? '' : url.slice(qIndex);
  const match = EXT_API_PATH_RE.exec(pathname);
  if (!match?.[1]) return null;

  let extensionId: string;
  try {
    extensionId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  const rest = match[2] ?? '';
  const targetPath = rest === '' ? '/' : rest;

  return { extensionId, targetPath, search };
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function upstreamPort(extension: ScannedExtension): number | undefined {
  const port = extension.meta.api?.port ?? extension.service?.port;
  return typeof port === 'number' && Number.isFinite(port) ? port : undefined;
}

function collectForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    headers.append(name, value);
  });
  return headers;
}

/**
 * `ALL /api/ext/:id/*` → `http://127.0.0.1:<port>/<remainder>`.
 * Disabled customer extensions get 403; builtins always proxy.
 */
export function createExtApiProxyHandler(
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
  fetchImpl: ProxyFetch = globalThis.fetch,
): GatewayHandler {
  return async (request) => {
    const url = new URL(request.url);
    const parsed = parseExtApiPath(`${url.pathname}${url.search}`);
    if (!parsed) {
      return null;
    }

    const extension = getModel().extensions.find(
      (ext) => ext.id === parsed.extensionId,
    );
    if (!extension) {
      return plainResponse(404, `Unknown extension: ${parsed.extensionId}`);
    }

    if (!state.isEnabled(extension)) {
      return plainResponse(403, `Extension disabled: ${parsed.extensionId}`);
    }

    const port = upstreamPort(extension);
    if (port == null) {
      return plainResponse(
        502,
        `No upstream port configured for extension: ${parsed.extensionId}`,
      );
    }

    const targetUrl = `http://127.0.0.1:${port}${parsed.targetPath}${parsed.search}`;
    const method = request.method.toUpperCase();
    const headers = collectForwardHeaders(request);

    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    let upstream: Response;
    try {
      upstream = await fetchImpl(targetUrl, {
        method,
        headers,
        body:
          body && body.byteLength > 0 && method !== 'GET' && method !== 'HEAD'
            ? body
            : undefined,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Upstream request failed';
      return plainResponse(
        502,
        `Bad gateway for ${parsed.extensionId}: ${message}`,
      );
    }

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, name) => {
      if (HOP_BY_HOP.has(name.toLowerCase())) return;
      responseHeaders.set(name, value);
    });

    if (method === 'HEAD') {
      return new Response(null, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  };
}
