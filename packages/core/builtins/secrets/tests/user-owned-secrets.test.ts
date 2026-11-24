import { describe, expect, test } from 'bun:test';

import {
  ORG_ID_HEADER,
  USER_ID_HEADER,
} from '@agentos/core/builtins/secrets/api/lib/constants';
import { vaultStorageKey } from '@agentos/core/builtins/secrets/api/lib/db-store-client';
import {
  handleSecretsRequest,
  type SecretsContext,
} from '@agentos/core/builtins/secrets/api/lib/handle-request';

import { memoryDb } from './memory-db';

const MASTER_KEY_HEX = 'd'.repeat(64);
const runtimeEnv = { AGENT_OS_EXT_SECRETS_MASTER_KEY: MASTER_KEY_HEX };
const KEY = 'files/google-drive';

type Audit = {
  action: string;
  resource?: string;
  meta?: Record<string, unknown>;
  orgId?: string;
};

/** Session caller `userId` in `org_a`; `isAdmin` grants every RBAC permission. */
function sessionCtx(
  db: ReturnType<typeof memoryDb>,
  userId: string,
  isAdmin: boolean,
  audits: Audit[] = [],
): SecretsContext {
  return {
    runtimeEnv,
    db,
    resolveOrg: async () => ({
      ok: true,
      orgId: 'org_a',
      via: 'session',
      userId,
    }),
    checkPermission: async () => (isAdmin ? 'ok' : 'denied'),
    appendAudit: async (entry) => {
      audits.push(entry);
    },
  };
}

function sessionRequest(method: string, path: string, body?: unknown) {
  return new Request(`http://127.0.0.1:6118${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: 'session=x' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function peerRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  return new Request(`http://127.0.0.1:6118${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ownPath = (userId: string) =>
  `/secrets/${encodeURIComponent(KEY)}?ownerUserId=${encodeURIComponent(userId)}`;

describe('user-owned secrets', () => {
  test('owner can put/get/delete without secrets.* RBAC', async () => {
    const db = memoryDb();
    const audits: Audit[] = [];
    const ctx = sessionCtx(db, 'user_alice', false, audits);

    const put = await handleSecretsRequest(
      ctx,
      sessionRequest('PUT', ownPath('user_alice'), { value: 'alice-token' }),
    );
    expect(put.status).toBe(201);
    expect(await put.json()).toMatchObject({
      key: KEY,
      ownerUserId: 'user_alice',
    });

    const stored = db.rows.get(`org_a::${vaultStorageKey(KEY, 'user_alice')}`);
    expect(stored?.ownerUserId).toBe('user_alice');
    expect(stored?.ciphertext).not.toContain('alice-token');

    const get = await handleSecretsRequest(
      ctx,
      sessionRequest('GET', ownPath('user_alice')),
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({
      key: KEY,
      value: 'alice-token',
      ownerUserId: 'user_alice',
      source: 'vault',
    });

    const del = await handleSecretsRequest(
      ctx,
      sessionRequest('DELETE', ownPath('user_alice')),
    );
    expect(del.status).toBe(200);

    expect(audits.map((a) => a.action)).toEqual([
      'secrets.put',
      'secrets.delete',
    ]);
    for (const entry of audits) {
      expect(entry.meta).toEqual({ key: KEY, ownerUserId: 'user_alice' });
      expect(entry.orgId).toBe('org_a');
      expect(JSON.stringify(entry)).not.toContain('alice-token');
    }
  });

  test('admins and other users cannot read, write, or delete it', async () => {
    const db = memoryDb();
    await handleSecretsRequest(
      sessionCtx(db, 'user_alice', false),
      sessionRequest('PUT', ownPath('user_alice'), { value: 'alice-token' }),
    );

    const admin = sessionCtx(db, 'user_admin', true);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await handleSecretsRequest(
        admin,
        sessionRequest(
          method,
          ownPath('user_alice'),
          method === 'PUT' ? { value: 'hijack' } : undefined,
        ),
      );
      expect(res.status).toBe(403);
    }

    const bob = await handleSecretsRequest(
      sessionCtx(db, 'user_bob', false),
      sessionRequest('GET', ownPath('user_alice')),
    );
    expect(bob.status).toBe(403);

    // Admin org-scoped read of the same key never surfaces the user row.
    const orgRead = await handleSecretsRequest(
      admin,
      sessionRequest('GET', `/secrets/${encodeURIComponent(KEY)}`),
    );
    expect(orgRead.status).toBe(404);
  });

  test('org-owned and user-owned rows with the same key are independent', async () => {
    const db = memoryDb();
    await handleSecretsRequest(
      sessionCtx(db, 'user_admin', true),
      sessionRequest('PUT', `/secrets/${encodeURIComponent(KEY)}`, {
        value: 'org-token',
      }),
    );
    await handleSecretsRequest(
      sessionCtx(db, 'user_alice', false),
      sessionRequest('PUT', ownPath('user_alice'), { value: 'alice-token' }),
    );

    const org = await handleSecretsRequest(
      sessionCtx(db, 'user_admin', true),
      sessionRequest('GET', `/secrets/${encodeURIComponent(KEY)}`),
    );
    expect(await org.json()).toMatchObject({ value: 'org-token' });
    const own = await handleSecretsRequest(
      sessionCtx(db, 'user_alice', false),
      sessionRequest('GET', ownPath('user_alice')),
    );
    expect(await own.json()).toMatchObject({ value: 'alice-token' });
  });

  test('list excludes user-owned secrets for everyone, including the owner', async () => {
    const db = memoryDb();
    await handleSecretsRequest(
      sessionCtx(db, 'user_admin', true),
      sessionRequest('PUT', '/secrets/stripe', { value: 'sk' }),
    );
    await handleSecretsRequest(
      sessionCtx(db, 'user_alice', false),
      sessionRequest('PUT', ownPath('user_alice'), { value: 'alice-token' }),
    );

    const adminList = await handleSecretsRequest(
      sessionCtx(db, 'user_admin', true),
      sessionRequest('GET', '/secrets'),
    );
    const body = (await adminList.json()) as { keys: Array<{ key: string }> };
    expect(body.keys.map((k) => k.key)).toEqual(['stripe']);

    const peerList = await handleSecretsRequest(
      { runtimeEnv, db },
      peerRequest('GET', '/secrets', {
        [ORG_ID_HEADER]: 'org_a',
        [USER_ID_HEADER]: 'user_alice',
      }),
    );
    const peerBody = (await peerList.json()) as {
      keys: Array<{ key: string }>;
    };
    expect(peerBody.keys.map((k) => k.key)).toEqual(['stripe']);
  });

  test('peer access requires a matching X-AgentOS-User-Id', async () => {
    const db = memoryDb();
    const ctx: SecretsContext = { runtimeEnv, db };
    const put = await handleSecretsRequest(
      ctx,
      peerRequest(
        'PUT',
        ownPath('user_alice'),
        { [ORG_ID_HEADER]: 'org_a', [USER_ID_HEADER]: 'user_alice' },
        { value: 'alice-token' },
      ),
    );
    expect(put.status).toBe(201);

    const noUser = await handleSecretsRequest(
      ctx,
      peerRequest('GET', ownPath('user_alice'), { [ORG_ID_HEADER]: 'org_a' }),
    );
    expect(noUser.status).toBe(403);
    expect(await noUser.json()).toEqual({
      error: 'X-AgentOS-User-Id required for user-owned secrets',
    });

    const wrongUser = await handleSecretsRequest(
      ctx,
      peerRequest('GET', ownPath('user_alice'), {
        [ORG_ID_HEADER]: 'org_a',
        [USER_ID_HEADER]: 'user_bob',
      }),
    );
    expect(wrongUser.status).toBe(403);

    const ok = await handleSecretsRequest(
      ctx,
      peerRequest('GET', ownPath('user_alice'), {
        [ORG_ID_HEADER]: 'org_a',
        [USER_ID_HEADER]: 'user_alice',
      }),
    );
    expect(await ok.json()).toMatchObject({ value: 'alice-token' });

    const otherOrg = await handleSecretsRequest(
      ctx,
      peerRequest('GET', ownPath('user_alice'), {
        [ORG_ID_HEADER]: 'org_b',
        [USER_ID_HEADER]: 'user_alice',
      }),
    );
    expect(otherOrg.status).toBe(404);
  });

  test('user-owned GET has no env fallback', async () => {
    const res = await handleSecretsRequest(
      {
        runtimeEnv: {
          ...runtimeEnv,
          AGENT_OS_EXT_SECRETS_MAP: JSON.stringify({ [KEY]: 'env-value' }),
        },
        db: memoryDb(),
      },
      peerRequest('GET', ownPath('user_alice'), {
        [ORG_ID_HEADER]: 'org_a',
        [USER_ID_HEADER]: 'user_alice',
      }),
    );
    expect(res.status).toBe(404);
  });

  test('purge deletes only that user’s secrets in the org, audits, and publishes', async () => {
    const db = memoryDb();
    const audits: Audit[] = [];
    const events: Array<{ topic: string; payload: unknown }> = [];
    const ctx: SecretsContext = {
      runtimeEnv,
      db,
      appendAudit: async (entry) => {
        audits.push(entry);
      },
      publishEvent: async (topic, payload) => {
        events.push({ topic, payload });
      },
    };
    const put = (org: string, user: string | null, key: string) =>
      handleSecretsRequest(
        ctx,
        peerRequest(
          'PUT',
          user
            ? `/secrets/${encodeURIComponent(key)}?ownerUserId=${user}`
            : `/secrets/${encodeURIComponent(key)}`,
          user
            ? { [ORG_ID_HEADER]: org, [USER_ID_HEADER]: user }
            : { [ORG_ID_HEADER]: org },
          { value: 'v' },
        ),
      );
    await put('org_a', 'user_alice', 'files/google-drive');
    await put('org_a', 'user_alice', 'files/onedrive');
    await put('org_a', 'user_bob', 'files/google-drive');
    await put('org_b', 'user_alice', 'files/google-drive');
    await put('org_a', null, 'stripe');
    audits.length = 0;

    const session = await handleSecretsRequest(
      sessionCtx(db, 'user_admin', true),
      sessionRequest('POST', '/users/user_alice/purge'),
    );
    expect(session.status).toBe(403);

    const res = await handleSecretsRequest(
      ctx,
      peerRequest('POST', '/users/user_alice/purge', {
        [ORG_ID_HEADER]: 'org_a',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: 'org_a',
      userId: 'user_alice',
      deleted: 2,
    });

    const remaining = [...db.rows.values()]
      .map((r) => `${r.orgId}:${r.ownerUserId ?? '-'}:${r.key}`)
      .sort();
    expect(remaining).toEqual([
      'org_a:-:stripe',
      'org_a:user_bob:files/google-drive',
      'org_b:user_alice:files/google-drive',
    ]);

    expect(audits).toEqual([
      {
        action: 'secrets.user_purged',
        resource: 'user_alice',
        meta: { ownerUserId: 'user_alice', count: 2 },
        orgId: 'org_a',
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.topic).toBe('secrets.user_purged');
    expect(events[0]?.payload).toMatchObject({
      orgId: 'org_a',
      userId: 'user_alice',
      count: 2,
    });
  });
});
