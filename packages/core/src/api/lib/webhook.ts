/**
 * @agentos/core/api/webhook — inbound webhook helpers (ticket 78).
 * HMAC signature verify, timestamp skew, and idempotency via cache-store.
 */

import {
  hmacSha256Base64,
  hmacSha256Base64Url,
  hmacSha256Hex,
  timingSafeEqualString,
} from './hmac';
import { cacheStore } from './store';

export type WebhookSignatureEncoding = 'hex' | 'base64' | 'base64url';

export type VerifyWebhookSignatureInput = {
  rawBody: string | Uint8Array;
  secret: string;
  /** Header / query signature value from the provider. */
  signature: string;
  encoding?: WebhookSignatureEncoding;
  /**
   * Strip a known prefix before compare (e.g. `sha256=`).
   * Comparison is timing-safe on the remainder.
   */
  prefix?: string;
};

export type VerifyTimestampSkewInput = {
  /** Unix epoch seconds (or ms if value looks like ms). */
  timestamp: number | string;
  /** Allowed clock skew in seconds (default 300). */
  skewSeconds?: number;
  nowSeconds?: number;
};

/** Minimal key/value store for idempotency (defaults to `cacheStore`). */
export type IdempotencyStore = {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
};

export type WithIdempotencyInput<T> = {
  /** Stable delivery id (provider event id, `Idempotency-Key`, …). */
  key: string;
  /** TTL for the idempotency record (default 86400). */
  ttlSeconds?: number;
  store?: IdempotencyStore;
  run: () => Promise<T>;
};

export type IdempotencyResult<T> =
  { status: 'executed'; result: T } | { status: 'duplicate'; result: unknown };

function stripPrefix(signature: string, prefix?: string): string {
  if (!prefix) return signature.trim();
  const trimmed = signature.trim();
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim();
  return trimmed;
}

async function expectedSignature(
  secret: string,
  rawBody: string | Uint8Array,
  encoding: WebhookSignatureEncoding,
): Promise<string> {
  switch (encoding) {
    case 'base64':
      return hmacSha256Base64(secret, rawBody);
    case 'base64url':
      return hmacSha256Base64Url(secret, rawBody);
    case 'hex':
    default:
      return hmacSha256Hex(secret, rawBody);
  }
}

/**
 * Verify an HMAC-SHA256 webhook signature (timing-safe).
 * Returns false on mismatch or empty inputs.
 */
export async function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): Promise<boolean> {
  const encoding = input.encoding ?? 'hex';
  const provided = stripPrefix(input.signature, input.prefix);
  if (!input.secret || !provided) return false;
  const expected = await expectedSignature(
    input.secret,
    input.rawBody,
    encoding,
  );
  return timingSafeEqualString(expected, provided);
}

/**
 * Reject timestamps outside the skew window (replay protection).
 * Accepts unix seconds, or milliseconds when the absolute value is ≥ 1e12.
 */
export function verifyTimestampSkew(input: VerifyTimestampSkewInput): boolean {
  const skew = input.skewSeconds ?? 300;
  if (!Number.isFinite(skew) || skew < 0) return false;

  let raw =
    typeof input.timestamp === 'string'
      ? Number(input.timestamp)
      : input.timestamp;
  if (!Number.isFinite(raw)) return false;
  if (Math.abs(raw) >= 1e12) raw = Math.floor(raw / 1000);

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return Math.abs(now - raw) <= skew;
}

/**
 * Run a handler at most once per idempotency key.
 * Duplicate deliveries return the cached result without re-running `run`.
 */
export async function withIdempotency<T>(
  input: WithIdempotencyInput<T>,
): Promise<IdempotencyResult<T>> {
  const key = input.key.trim();
  if (!key) {
    throw new Error('withIdempotency: key must be a non-empty string');
  }
  const store = input.store ?? cacheStore;
  const ttl = input.ttlSeconds ?? 86_400;
  const cacheKey = `webhook:idempotency:${key}`;

  const existing = await store.get(cacheKey);
  if (existing !== null && existing !== undefined) {
    return { status: 'duplicate', result: existing };
  }

  const result = await input.run();
  await store.set(cacheKey, result as unknown, ttl);
  return { status: 'executed', result };
}

/**
 * Convenience: verify signature + optional timestamp, then run with idempotency.
 * Throws `WebhookVerifyError` when signature/timestamp checks fail.
 */
export class WebhookVerifyError extends Error {
  readonly code: 'signature' | 'timestamp';

  constructor(code: 'signature' | 'timestamp', message: string) {
    super(message);
    this.name = 'WebhookVerifyError';
    this.code = code;
  }
}

export type VerifyAndHandleWebhookInput<T> = {
  rawBody: string | Uint8Array;
  secret: string;
  signature: string;
  encoding?: WebhookSignatureEncoding;
  prefix?: string;
  /** When set, enforce skew window. */
  timestamp?: number | string;
  skewSeconds?: number;
  nowSeconds?: number;
  idempotencyKey: string;
  ttlSeconds?: number;
  store?: IdempotencyStore;
  run: () => Promise<T>;
};

export async function verifyAndHandleWebhook<T>(
  input: VerifyAndHandleWebhookInput<T>,
): Promise<IdempotencyResult<T>> {
  const ok = await verifyWebhookSignature({
    rawBody: input.rawBody,
    secret: input.secret,
    signature: input.signature,
    encoding: input.encoding,
    prefix: input.prefix,
  });
  if (!ok) {
    throw new WebhookVerifyError('signature', 'webhook signature mismatch');
  }
  if (input.timestamp !== undefined) {
    const skewOk = verifyTimestampSkew({
      timestamp: input.timestamp,
      skewSeconds: input.skewSeconds,
      nowSeconds: input.nowSeconds,
    });
    if (!skewOk) {
      throw new WebhookVerifyError(
        'timestamp',
        'webhook timestamp out of skew',
      );
    }
  }
  return withIdempotency({
    key: input.idempotencyKey,
    ttlSeconds: input.ttlSeconds,
    store: input.store,
    run: input.run,
  });
}
