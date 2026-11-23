/**
 * Short-lived signed public-link tokens for unauthenticated extension portals
 * (ticket 72). Not a Better Auth session — HMAC payload bound to orgId.
 */

import { requireSession } from './auth';
import type { AppContext, Middleware, Next } from './types';

const PUBLIC_ACCESS_KEY = 'auth.publicAccess';

/**
 * Default public-link `purpose` → limited role when `role` is omitted.
 * Mirrors builtin auth `PUBLIC_PURPOSE_DEFAULT_ROLE` (ticket 75).
 */
export const PUBLIC_PURPOSE_DEFAULT_ROLE: Record<string, string> = {
  portal: 'external_viewer',
  'trust-center': 'external_viewer',
  'client-link': 'external_viewer',
};

/** Signed public-link payload. */
export type PublicTokenPayload = {
  orgId: string;
  extensionId: string;
  purpose: string;
  /** Unix epoch seconds. */
  exp: number;
  /** Optional upstream path prefix this token is valid for. */
  pathPrefix?: string;
  /**
   * Limited role for portal authorization (default via purpose →
   * `external_viewer`). Not a Better Auth session role.
   */
  role?: string;
};

export type SignPublicTokenInput = {
  orgId: string;
  extensionId: string;
  purpose: string;
  /** Time-to-live in seconds (default 3600). */
  ttlSeconds?: number;
  pathPrefix?: string;
  /** Explicit limited role; otherwise derived from `purpose`. */
  role?: string;
  /** Override signing secret (tests). Defaults to env. */
  secret?: string;
};

/** Resolve the limited role carried by a public token. */
export function resolvePublicTokenRole(
  payload: Pick<PublicTokenPayload, 'purpose' | 'role'>,
): string {
  if (payload.role && payload.role.trim()) {
    return payload.role.trim();
  }
  return PUBLIC_PURPOSE_DEFAULT_ROLE[payload.purpose] ?? 'external_viewer';
}

export type RequirePublicTokenOptions = {
  purposes?: string[];
  /** Override verify secret (tests). */
  secret?: string;
};

function unauthenticated(c: AppContext): Response {
  return c.json({ error: 'unauthenticated' }, { status: 401 });
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function resolveSecret(override?: string): string {
  const secret = override ?? Bun.env.AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET must be set (≥16 chars) to sign/verify public tokens',
    );
  }
  return secret;
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return encodeBase64Url(new Uint8Array(sig));
}

async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Canonical JSON (sorted keys) for stable HMAC input. */
function stablePayloadJson(payload: PublicTokenPayload): string {
  const ordered: Record<string, unknown> = {
    exp: payload.exp,
    extensionId: payload.extensionId,
    orgId: payload.orgId,
    purpose: payload.purpose,
  };
  if (payload.pathPrefix != null) {
    ordered.pathPrefix = payload.pathPrefix;
  }
  if (payload.role != null) {
    ordered.role = payload.role;
  }
  return JSON.stringify(ordered);
}

/**
 * Mint a short-lived public link token.
 * Token format: `base64url(payloadJson).base64url(hmac)`.
 */
export async function signPublicToken(
  input: SignPublicTokenInput,
): Promise<string> {
  const secret = resolveSecret(input.secret);
  const ttl = input.ttlSeconds ?? 3600;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error('ttlSeconds must be a positive number');
  }
  const payload: PublicTokenPayload = {
    orgId: input.orgId,
    extensionId: input.extensionId,
    purpose: input.purpose,
    exp: Math.floor(Date.now() / 1000) + Math.floor(ttl),
  };
  if (input.pathPrefix) payload.pathPrefix = input.pathPrefix;
  const role =
    input.role?.trim() ||
    PUBLIC_PURPOSE_DEFAULT_ROLE[input.purpose] ||
    'external_viewer';
  payload.role = role;

  const body = stablePayloadJson(payload);
  const bodyB64 = encodeBase64Url(new TextEncoder().encode(body));
  const sig = await hmacSign(secret, bodyB64);
  return `${bodyB64}.${sig}`;
}

/** Verify and decode a public token. Returns null when invalid/expired. */
export async function verifyPublicToken(
  token: string,
  options: { secret?: string; nowSeconds?: number } = {},
): Promise<PublicTokenPayload | null> {
  try {
    const secret = resolveSecret(options.secret);
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [bodyB64, sig] = parts;
    if (!bodyB64 || !sig) return null;
    if (!(await hmacVerify(secret, bodyB64, sig))) return null;

    const json = new TextDecoder().decode(decodeBase64Url(bodyB64));
    const parsed = JSON.parse(json) as Partial<PublicTokenPayload>;
    if (
      typeof parsed.orgId !== 'string' ||
      typeof parsed.extensionId !== 'string' ||
      typeof parsed.purpose !== 'string' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (parsed.exp <= now) return null;

    const payload: PublicTokenPayload = {
      orgId: parsed.orgId,
      extensionId: parsed.extensionId,
      purpose: parsed.purpose,
      exp: parsed.exp,
    };
    if (typeof parsed.pathPrefix === 'string') {
      payload.pathPrefix = parsed.pathPrefix;
    }
    if (typeof parsed.role === 'string' && parsed.role.trim()) {
      payload.role = parsed.role.trim();
    } else {
      payload.role = resolvePublicTokenRole(payload);
    }
    return payload;
  } catch {
    return null;
  }
}

/** Extract bearer or `?token=` from the request. */
export function extractPublicToken(c: AppContext): string | null {
  const auth = c.req.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)/i.exec(auth.trim());
    if (match?.[1]) return match[1];
  }
  const url = new URL(c.req.url);
  const q = url.searchParams.get('token');
  return q && q.length > 0 ? q : null;
}

/** Whether `pathname` falls under any declared public API prefix. */
export function isPublicApiPath(
  pathname: string,
  prefixes: readonly string[],
): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const raw of prefixes) {
    const prefix = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (prefix === '/') return true;
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/** Read public access stashed by `requirePublicToken`. */
export function getPublicAccess(c: AppContext): PublicTokenPayload | undefined {
  return c.get<PublicTokenPayload>(PUBLIC_ACCESS_KEY);
}

/**
 * Require a valid signed public token (no Better Auth session).
 * Accepts `Authorization: Bearer` or `?token=`.
 */
export function requirePublicToken(
  options: RequirePublicTokenOptions = {},
): Middleware {
  return async (c: AppContext, next: Next) => {
    const token = extractPublicToken(c);
    if (!token) return unauthenticated(c);

    const payload = await verifyPublicToken(token, { secret: options.secret });
    if (!payload) return unauthenticated(c);

    if (options.purposes && options.purposes.length > 0) {
      if (!options.purposes.includes(payload.purpose)) {
        return unauthenticated(c);
      }
    }

    if (payload.pathPrefix) {
      const path = new URL(c.req.url).pathname.replace(/\/+$/, '') || '/';
      if (!isPublicApiPath(path, [payload.pathPrefix])) {
        return unauthenticated(c);
      }
    }

    c.set(PUBLIC_ACCESS_KEY, payload);
    return next();
  };
}

/**
 * Default-deny gate used when an extension declares `meta.public.apiPrefixes`.
 * Public prefixes require a signed token; everything else requires a session.
 * `GET /health` is always open.
 */
export function createDefaultAccessMiddleware(
  publicApiPrefixes: readonly string[],
  options: RequirePublicTokenOptions = {},
): Middleware {
  const publicMw = requirePublicToken(options);
  return async (c: AppContext, next: Next) => {
    const url = new URL(c.req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' && c.req.method.toUpperCase() === 'GET') {
      return next();
    }
    if (isPublicApiPath(path, publicApiPrefixes)) {
      return publicMw(c, next);
    }
    return requireSession(c, next);
  };
}
