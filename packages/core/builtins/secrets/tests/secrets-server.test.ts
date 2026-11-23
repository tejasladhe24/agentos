import { describe, expect, test } from 'bun:test';

import { ORG_ID_HEADER } from '@agentos/core/builtins/secrets/api/lib/constants';
import type {
  SecretsDbStoreClient,
  VaultRecord,
} from '@agentos/core/builtins/secrets/api/lib/db-store-client';
import { handleSecretsRequest } from '@agentos/core/builtins/secrets/api/lib/handle-request';

const MASTER_KEY_HEX = 'c'.repeat(64);

function memoryDb(): SecretsDbStoreClient & {
  rows: Map<string, VaultRecord>;
} {
  const rows = new Map<string, VaultRecord>();
  const id = (orgId: string, key: string) => `${orgId}::${key}`;
  return {
    rows,
    async get(orgId, key) {
      return rows.get(id(orgId, key));
    },
    async list(orgId) {
      const prefix = `${orgId}::`;
      const out: VaultRecord[] = [];
      for (const [rowId, record] of rows) {
        if (rowId.startsWith(prefix)) out.push(record);
      }
      return out;
    },
    async put(orgId, record) {
      const stored = { ...record, orgId };
      rows.set(id(orgId, record.key), stored);
      return stored;
    },
    async delete(orgId, key) {
      return rows.delete(id(orgId, key));
    },
  };
}

function orgRequest(
  method: string,
  path: string,
  orgId: string,
  body?: unknown,
): Request {
  return new Request(`http://127.0.0.1:6118${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      [ORG_ID_HEADER]: orgId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('builtin secrets server', () => {
  test('resolves from map and per-key env (fallback)', async () => {
    const runtimeEnv = {
      AGENT_OS_EXT_SECRETS_MAP: JSON.stringify({ stripe: 'sk_map' }),
      AGENT_OS_EXT_SECRETS_API_TOKEN: 'tok_env',
    };

    const health = await handleSecretsRequest(
      { runtimeEnv },
      new Request('http://127.0.0.1:6118/health'),
    );
    expect(await health.json()).toEqual({
      ok: true,
      vault: false,
      masterKey: false,
    });

    const fromMap = await handleSecretsRequest(
      { runtimeEnv },
      new Request('http://127.0.0.1:6118/secrets/stripe'),
    );
    expect(fromMap.status).toBe(200);
    expect(await fromMap.json()).toEqual({
      key: 'stripe',
      value: 'sk_map',
      source: 'env',
    });

    const fromEnv = await handleSecretsRequest(
      { runtimeEnv },
      new Request('http://127.0.0.1:6118/secrets/api-token'),
    );
    expect(fromEnv.status).toBe(200);
    expect(await fromEnv.json()).toEqual({
      key: 'api-token',
      value: 'tok_env',
      source: 'env',
    });

    const missing = await handleSecretsRequest(
      { runtimeEnv },
      new Request('http://127.0.0.1:6118/secrets/missing'),
    );
    expect(missing.status).toBe(404);
  });

  test('vault put/get/delete with org isolation + encryption', async () => {
    const db = memoryDb();
    const runtimeEnv = {
      AGENT_OS_EXT_SECRETS_MASTER_KEY: MASTER_KEY_HEX,
      AGENT_OS_EXT_SECRETS_MAP: JSON.stringify({ stripe: 'sk_env' }),
    };
    const ctx = { runtimeEnv, db };

    const putA = await handleSecretsRequest(
      ctx,
      orgRequest('PUT', '/secrets/qbo', 'org_a', {
        value: 'refresh_a',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    expect(putA.status).toBe(201);
    const putBody = (await putA.json()) as {
      key: string;
      version: number;
      rotatedAt: string;
      expiresAt?: string;
    };
    expect(putBody.key).toBe('qbo');
    expect(putBody.version).toBe(1);
    expect(putBody.expiresAt).toBe('2030-01-01T00:00:00.000Z');
    expect(JSON.stringify(putBody)).not.toContain('refresh_a');

    const stored = db.rows.get('org_a::qbo');
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain('refresh_a');
    expect(stored?.ciphertext).toBeTruthy();

    const getA = await handleSecretsRequest(
      ctx,
      orgRequest('GET', '/secrets/qbo', 'org_a'),
    );
    expect(getA.status).toBe(200);
    expect(await getA.json()).toMatchObject({
      key: 'qbo',
      value: 'refresh_a',
      version: 1,
      source: 'vault',
    });

    const getB = await handleSecretsRequest(
      ctx,
      orgRequest('GET', '/secrets/qbo', 'org_b'),
    );
    // No vault row for org_b → env fallback for stripe only; qbo missing → 404
    expect(getB.status).toBe(404);

    const rotate = await handleSecretsRequest(
      ctx,
      orgRequest('PUT', '/secrets/qbo', 'org_a', { value: 'refresh_a2' }),
    );
    expect(rotate.status).toBe(200);
    expect(await rotate.json()).toMatchObject({ key: 'qbo', version: 2 });

    const del = await handleSecretsRequest(
      ctx,
      orgRequest('DELETE', '/secrets/qbo', 'org_a'),
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ key: 'qbo', deleted: true });

    const afterDel = await handleSecretsRequest(
      ctx,
      orgRequest('GET', '/secrets/qbo', 'org_a'),
    );
    expect(afterDel.status).toBe(404);
  });

  test('GET /secrets lists metadata only (no values / ciphertext)', async () => {
    const db = memoryDb();
    const runtimeEnv = {
      AGENT_OS_EXT_SECRETS_MASTER_KEY: MASTER_KEY_HEX,
      AGENT_OS_EXT_SECRETS_MAP: JSON.stringify({ stripe: 'sk_env' }),
    };
    const audits: Array<{ action: string; meta?: Record<string, unknown> }> =
      [];
    const ctx = {
      runtimeEnv,
      db,
      appendAudit: async (input: {
        action: string;
        meta?: Record<string, unknown>;
      }) => {
        audits.push(input);
      },
    };

    await handleSecretsRequest(
      ctx,
      orgRequest('PUT', '/secrets/qbo', 'org_a', {
        value: 'super-secret-token',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    await handleSecretsRequest(
      ctx,
      orgRequest('PUT', '/secrets/stripe', 'org_a', { value: 'sk_vault' }),
    );
    await handleSecretsRequest(
      ctx,
      orgRequest('PUT', '/secrets/other', 'org_b', { value: 'other-secret' }),
    );

    const listed = await handleSecretsRequest(
      ctx,
      orgRequest('GET', '/secrets', 'org_a'),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      orgId: string;
      canWrite: boolean;
      keys: Array<Record<string, unknown>>;
    };
    expect(body.orgId).toBe('org_a');
    expect(body.canWrite).toBe(true);
    expect(body.keys).toHaveLength(2);
    const keys = body.keys.map((k) => k.key).sort();
    expect(keys).toEqual(['qbo', 'stripe']);
    for (const item of body.keys) {
      expect(item.hasValue).toBe(true);
      expect(item).not.toHaveProperty('value');
      expect(item).not.toHaveProperty('ciphertext');
      expect(item).not.toHaveProperty('iv');
    }
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
    expect(JSON.stringify(body)).not.toContain('sk_vault');
    expect(JSON.stringify(body)).not.toContain('sk_env');

    expect(audits.some((a) => a.action === 'secrets.put')).toBe(true);
    expect(
      audits.every((a) => !JSON.stringify(a).includes('super-secret')),
    ).toBe(true);

    const deniedList = await handleSecretsRequest(
      {
        runtimeEnv,
        db,
        resolveOrg: async () => ({
          ok: true,
          orgId: 'org_a',
          via: 'session',
        }),
        checkPermission: async (_req, permission) =>
          permission === 'secrets.read' ? 'denied' : 'ok',
      },
      new Request('http://127.0.0.1:6118/secrets', {
        method: 'GET',
        headers: { cookie: 'session=x' },
      }),
    );
    expect(deniedList.status).toBe(403);

    const readOnly = await handleSecretsRequest(
      {
        runtimeEnv,
        db,
        resolveOrg: async () => ({
          ok: true,
          orgId: 'org_a',
          via: 'session',
        }),
        checkPermission: async (_req, permission) =>
          permission === 'secrets.write' ? 'denied' : 'ok',
      },
      new Request('http://127.0.0.1:6118/secrets', {
        method: 'GET',
        headers: { cookie: 'session=x' },
      }),
    );
    expect(readOnly.status).toBe(200);
    expect(await readOnly.json()).toMatchObject({
      orgId: 'org_a',
      canWrite: false,
    });
  });

  test('PUT rejects invalid key names', async () => {
    const db = memoryDb();
    const bad = await handleSecretsRequest(
      {
        runtimeEnv: { AGENT_OS_EXT_SECRETS_MASTER_KEY: MASTER_KEY_HEX },
        db,
      },
      orgRequest('PUT', '/secrets/-bad', 'org_a', { value: 'v' }),
    );
    expect(bad.status).toBe(400);
  });

  test('PUT without master key → 503; session without permission → 403', async () => {
    const db = memoryDb();
    const noKey = await handleSecretsRequest(
      { runtimeEnv: {}, db },
      orgRequest('PUT', '/secrets/x', 'org_a', { value: 'v' }),
    );
    expect(noKey.status).toBe(503);

    const denied = await handleSecretsRequest(
      {
        runtimeEnv: { AGENT_OS_EXT_SECRETS_MASTER_KEY: MASTER_KEY_HEX },
        db,
        resolveOrg: async () => ({
          ok: true,
          orgId: 'org_a',
          via: 'session',
        }),
        checkPermission: async () => 'denied',
      },
      new Request('http://127.0.0.1:6118/secrets/x', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          cookie: 'session=x',
        },
        body: JSON.stringify({ value: 'v' }),
      }),
    );
    expect(denied.status).toBe(403);
  });
});
