/** Static `dist/` file serving + SPA fallback for `agentos start`. */

import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

import { pathUnderRoot } from '@agentos/core/gateway';

const MIME_BY_EXT: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Gateway / API prefixes that must not fall through to SPA `index.html`. */
export const SPA_RESERVED_PREFIXES = [
  '/_public',
  '/__agentos',
  '/api',
] as const;

function contentTypeFor(filePath: string): string {
  return (
    MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  );
}

/**
 * Resolve a URL pathname to a file under `distRoot` (traversal-safe).
 * Returns null when missing or not a file.
 */
export function resolveDistFile(
  distRoot: string,
  pathname: string,
): string | null {
  const path = pathname.split('?')[0] ?? pathname;
  if (!path || path.includes('\0')) return null;
  const rel = path === '/' ? '' : path.replace(/^\//, '');
  if (rel.includes('..')) return null;

  const root = resolve(distRoot);
  const candidate = resolve(root, normalize(rel));
  if (!pathUnderRoot(candidate, root)) return null;
  if (!existsSync(candidate)) return null;
  try {
    if (!statSync(candidate).isFile()) return null;
  } catch {
    return null;
  }
  return candidate;
}

export function isSpaReservedPath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname;
  for (const prefix of SPA_RESERVED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function fileResponse(
  filePath: string,
  method: string,
): Response | Promise<Response> {
  const headers = { 'Content-Type': contentTypeFor(filePath) };
  if (method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  return new Response(Bun.file(filePath), { status: 200, headers });
}

/**
 * Serve a static file from `distRoot` for GET/HEAD, or null if not found.
 */
export function tryServeStatic(
  distRoot: string,
  pathname: string,
  method: string,
): Response | Promise<Response> | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const filePath = resolveDistFile(distRoot, pathname);
  if (!filePath) return null;
  return fileResponse(filePath, method);
}

/**
 * SPA fallback to `dist/index.html` for navigations outside reserved prefixes.
 */
export function trySpaFallback(
  distRoot: string,
  pathname: string,
  method: string,
): Response | Promise<Response> | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (isSpaReservedPath(pathname)) return null;
  const indexPath = join(resolve(distRoot), 'index.html');
  if (!existsSync(indexPath)) return null;
  try {
    if (!statSync(indexPath).isFile()) return null;
  } catch {
    return null;
  }
  return fileResponse(indexPath, method);
}
