import { SECRETS_ALG } from './constants';

const IV_BYTES = 12;
const KEY_BYTES = 32;

export type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  alg: typeof SECRETS_ALG;
};

/**
 * Parse `AGENT_OS_EXT_SECRETS_MASTER_KEY` as 32 raw bytes.
 * Accepts base64 (preferred) or 64-char hex.
 */
export function parseMasterKey(raw: string | undefined): Uint8Array | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(KEY_BYTES);
    for (let i = 0; i < KEY_BYTES; i++) {
      out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  try {
    const decoded = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
    if (decoded.byteLength === KEY_BYTES) return decoded;
  } catch {
    // fall through
  }

  return null;
}

async function importAesKey(
  keyBytes: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    usages,
  );
}

/** Encrypt plaintext with AES-256-GCM. Returns base64 ciphertext + iv. */
export async function encryptSecret(
  plaintext: string,
  masterKey: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await importAesKey(masterKey, ['encrypt']);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    iv: bytesToBase64(iv),
    alg: SECRETS_ALG,
  };
}

/** Decrypt AES-256-GCM payload. Throws on auth failure / bad key. */
export async function decryptSecret(
  payload: EncryptedPayload,
  masterKey: Uint8Array,
): Promise<string> {
  if (payload.alg !== SECRETS_ALG) {
    throw new Error('unsupported secret algorithm');
  }
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const key = await importAesKey(masterKey, ['decrypt']);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plainBuf);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
