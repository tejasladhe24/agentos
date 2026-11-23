import { describe, expect, test } from 'bun:test';

import {
  decryptSecret,
  encryptSecret,
  parseMasterKey,
} from '@agentos/core/builtins/secrets/api/lib/crypto';

describe('secrets crypto', () => {
  const hexKey = 'a'.repeat(64);
  const key = parseMasterKey(hexKey)!;

  test('parseMasterKey accepts hex and base64', () => {
    expect(parseMasterKey(hexKey)?.byteLength).toBe(32);
    const b64 = btoa(String.fromCharCode(...key));
    expect(parseMasterKey(b64)?.byteLength).toBe(32);
    expect(parseMasterKey(undefined)).toBeNull();
    expect(parseMasterKey('short')).toBeNull();
  });

  test('encrypt/decrypt round-trip', async () => {
    const payload = await encryptSecret('sk_live_test', key);
    expect(payload.alg).toBe('AES-256-GCM');
    expect(payload.ciphertext).not.toContain('sk_live');
    expect(payload.iv.length).toBeGreaterThan(0);
    const plain = await decryptSecret(payload, key);
    expect(plain).toBe('sk_live_test');
  });

  test('wrong key fails decrypt', async () => {
    const payload = await encryptSecret('secret', key);
    const other = parseMasterKey('b'.repeat(64))!;
    await expect(decryptSecret(payload, other)).rejects.toThrow();
  });
});
