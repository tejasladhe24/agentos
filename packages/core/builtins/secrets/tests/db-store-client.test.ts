import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createDb } from '@agentos/core/builtins/db-store/api/lib/create-db';
import { handleDbStoreRequest } from '@agentos/core/builtins/db-store/api/lib/handle-request';
import {
  createSecretsDbStoreClient,
  type SecretsDbStoreClient,
  type VaultRecord,
} from '@agentos/core/builtins/secrets/api/lib/db-store-client';

function record(key: string, ownerUserId?: string): VaultRecord {
  return {
    key,
    ciphertext: `ct-${ownerUserId ?? 'org'}`,
    iv: 'iv',
    alg: 'AES-256-GCM',
    rotatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...(ownerUserId ? { ownerUserId } : {}),
  };
}

describe('secrets db-store client (real db-store handler)', () => {
  let server: ReturnType<typeof Bun.serve>;
  let client: SecretsDbStoreClient;

  beforeAll(async () => {
    const ctx = await createDb({ databasePath: ':memory:' });
    server = Bun.serve({
      port: 0,
      fetch: (request) => handleDbStoreRequest(ctx, request),
    });
    client = createSecretsDbStoreClient(`http://127.0.0.1:${server.port}`);
  });

  afterAll(() => {
    server.stop(true);
  });

  test('org and user rows with the same key never collide', async () => {
    await client.put('org_a', record('files/drive'));
    await client.put('org_a', record('files/drive', 'user_alice'));
    await client.put('org_a', record('files/drive', 'user_bob'));

    expect((await client.get('org_a', 'files/drive'))?.ciphertext).toBe(
      'ct-org',
    );
    const alice = await client.get('org_a', 'files/drive', 'user_alice');
    expect(alice).toMatchObject({
      key: 'files/drive',
      ownerUserId: 'user_alice',
      ciphertext: 'ct-user_alice',
    });
    expect(await client.get('org_a', 'files/drive', 'user_carol')).toBe(
      undefined,
    );
    expect(await client.get('org_b', 'files/drive', 'user_alice')).toBe(
      undefined,
    );
  });

  test('listOwnedBy + owner-scoped delete', async () => {
    await client.put('org_a', record('files/onedrive', 'user_alice'));
    const owned = await client.listOwnedBy('org_a', 'user_alice');
    expect(owned.map((r) => r.key).sort()).toEqual([
      'files/drive',
      'files/onedrive',
    ]);

    expect(await client.delete('org_a', 'files/drive', 'user_alice')).toBe(
      true,
    );
    expect(await client.get('org_a', 'files/drive', 'user_alice')).toBe(
      undefined,
    );
    expect(await client.get('org_a', 'files/drive')).toBeDefined();
    expect(await client.get('org_a', 'files/drive', 'user_bob')).toBeDefined();
  });
});
