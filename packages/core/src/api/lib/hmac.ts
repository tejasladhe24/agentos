/**
 * Shared WebCrypto HMAC helpers for API kit signing (oauth state, webhooks).
 */

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** HMAC-SHA256 → raw bytes. */
export async function hmacSha256Raw(
  secret: string,
  message: string | Uint8Array,
): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const data =
    typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}

/** HMAC-SHA256 → base64url (no padding). */
export async function hmacSha256Base64Url(
  secret: string,
  message: string | Uint8Array,
): Promise<string> {
  return encodeBase64Url(await hmacSha256Raw(secret, message));
}

/** HMAC-SHA256 → lowercase hex. */
export async function hmacSha256Hex(
  secret: string,
  message: string | Uint8Array,
): Promise<string> {
  return encodeHex(await hmacSha256Raw(secret, message));
}

/** HMAC-SHA256 → standard base64. */
export async function hmacSha256Base64(
  secret: string,
  message: string | Uint8Array,
): Promise<string> {
  const bytes = await hmacSha256Raw(secret, message);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
