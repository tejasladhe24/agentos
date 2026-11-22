import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { requestPathname } from './http';
import type { GatewayHandler } from './types';

/** URL prefix for consumer `public/` assets (ticket 44). */
export const PUBLIC_ASSETS_PREFIX = '/_public';

const MIME_BY_EXT: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** True when `file` is exactly `root` or a path under it (traversal-safe). */
export function pathUnderRoot(file: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return file === root || file.startsWith(normalizedRoot);
}

/**
 * Parse `/_public/<relpath>` (pathname only; query ignored).
 * Returns the relative path inside the public root, or null.
 */
export function parsePublicAssetPath(pathname: string): string | null {
  const path = pathname.split('?')[0] ?? pathname;
  if (path === PUBLIC_ASSETS_PREFIX || path === `${PUBLIC_ASSETS_PREFIX}/`) {
    return null;
  }
  const prefix = `${PUBLIC_ASSETS_PREFIX}/`;
  if (!path.startsWith(prefix)) return null;
  const rel = path.slice(prefix.length);
  if (!rel || rel.includes('\0')) return null;
  return rel;
}

function contentTypeFor(filePath: string): string {
  return (
    MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  );
}

/**
 * Resolve a public-asset relative path under `publicRoot`.
 * Returns null on traversal or missing file.
 */
export function resolvePublicAssetFile(
  publicRoot: string,
  relativePath: string,
): string | null {
  const root = resolve(publicRoot);
  const candidate = resolve(root, normalize(relativePath));
  if (!pathUnderRoot(candidate, root)) return null;
  if (!existsSync(candidate)) return null;
  try {
    const st = statSync(candidate);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return candidate;
}

/** Minimal HTML body for missing `/_public/<file>` (gateway owns HTTP 404). */
export function publicAssetNotFoundHtml(pathname: string): string {
  const safe = pathname
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Not Found</title>
</head>
<body>
<h1>Not Found</h1>
<p>AgentOS public asset not found: ${safe}</p>
</body>
</html>
`;
}

/** Absolute public root from Vite root + resolved `publicDir`. */
export function resolvePublicRoot(viteRoot: string, publicDir: string): string {
  return join(resolve(viteRoot), publicDir);
}

/**
 * Serve consumer `public/` files at `/_public/<path>`.
 * Missing files return HTTP 404 with a minimal HTML body (not SPA fallback).
 */
export function createPublicAssetsHandler(
  getPublicRoot: () => string,
): GatewayHandler {
  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }
    const pathname = requestPathname(request);
    const relative = parsePublicAssetPath(pathname);
    if (relative == null) {
      return null;
    }

    const filePath = resolvePublicAssetFile(getPublicRoot(), relative);
    if (!filePath) {
      const headers = { 'Content-Type': 'text/html; charset=utf-8' };
      if (request.method === 'HEAD') {
        return new Response(null, { status: 404, headers });
      }
      return new Response(publicAssetNotFoundHtml(pathname), {
        status: 404,
        headers,
      });
    }

    const headers = { 'Content-Type': contentTypeFor(filePath) };
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }
    try {
      return new Response(readFileSync(filePath), { status: 200, headers });
    } catch {
      return null;
    }
  };
}
