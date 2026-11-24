import { afterEach, describe, expect, test } from 'bun:test';

import {
  createHttpIntegrationsBackend,
  createIntegrationsKit,
  createMemoryIntegrationsBackend,
  handleIntegrationRoutes,
  INTEGRATION_CHANGED_TOPIC,
  integrationSecretKey,
  PERMISSION_INTEGRATIONS_MANAGE,
  type IntegrationDefinition,
  type IntegrationRoutesContext,
} from '@agentos/core/api/integrations';

const SECRET = 're_live_supersecret_123';

function setup(ttlMs = 30_000) {
  let clock = 1_700_000_000_000;
  const backend = createMemoryIntegrationsBackend();
  const kit = createIntegrationsKit(backend, { ttlMs, now: () => clock });
  return {
    backend,
    kit,
    tick(ms: number) {
      clock += ms;
    },
  };
}

type FakeProvider = { name: string; apiKey: string };

const fromConfig = (c: { provider: string; secrets: Record<string, string> }) =>
  ({ name: c.provider, apiKey: c.secrets.apiKey ?? '' }) as FakeProvider;
const fromEnv = () => ({ name: 'log', apiKey: 'env' }) as FakeProvider;

describe('integrations kit', () => {
  test('org with a record resolves its config; org without one falls back to env', async () => {
    const { kit } = setup();
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'a@example.com' },
      secrets: { apiKey: SECRET },
    });

    const a = await kit.resolveProvider(
      'org_a',
      'email.send',
      fromConfig,
      fromEnv,
    );
    expect(a.source).toBe('tenant');
    expect(a.provider).toEqual({ name: 'resend', apiKey: SECRET });

    const b = await kit.resolveProvider(
      'org_b',
      'email.send',
      fromConfig,
      fromEnv,
    );
    expect(b.source).toBe('platform');
    expect(b.provider.name).toBe('log');

    const none = await kit.resolveProvider(
      null,
      'email.send',
      fromConfig,
      fromEnv,
    );
    expect(none.source).toBe('platform');

    expect(await kit.getIntegration('org_b', 'email.send')).toBeNull();
  });

  test('per-org isolation of records and vault keys', async () => {
    const { kit, backend } = setup();
    await kit.putIntegration('org_a', {
      integration: 'sms',
      provider: 'twilio',
      secrets: { authToken: 'token-a' },
    });
    await kit.putIntegration('org_b', {
      integration: 'sms',
      provider: 'twilio',
      secrets: { authToken: 'token-b' },
    });
    expect((await kit.getIntegration('org_a', 'sms'))?.secrets.authToken).toBe(
      'token-a',
    );
    expect((await kit.getIntegration('org_b', 'sms'))?.secrets.authToken).toBe(
      'token-b',
    );
    await kit.deleteIntegration('org_a', 'sms');
    expect(await kit.getIntegration('org_a', 'sms')).toBeNull();
    expect((await kit.getIntegration('org_b', 'sms'))?.secrets.authToken).toBe(
      'token-b',
    );
    expect(
      await backend.getSecret(
        'org_a',
        integrationSecretKey('sms', 'default', 'authToken'),
      ),
    ).toBeNull();
  });

  test('put → resolve → put new secret → resolve returns new value without restart', async () => {
    const { kit } = setup();
    let builds = 0;
    const build = (c: {
      provider: string;
      secrets: Record<string, string>;
    }) => {
      builds += 1;
      return fromConfig(c);
    };
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      secrets: { apiKey: 'first' },
    });
    expect(
      (await kit.resolveProvider('org_a', 'email.send', build, fromEnv))
        .provider.apiKey,
    ).toBe('first');
    // Cached: no rebuild on second resolve.
    await kit.resolveProvider('org_a', 'email.send', build, fromEnv);
    expect(builds).toBe(1);

    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      secrets: { apiKey: 'second' },
    });
    const next = await kit.resolveProvider(
      'org_a',
      'email.send',
      build,
      fromEnv,
    );
    expect(next.provider.apiKey).toBe('second');
    expect(builds).toBe(2);
  });

  test('integration.changed from another replica invalidates the cache', async () => {
    const backend = createMemoryIntegrationsBackend();
    const replicaA = createIntegrationsKit(backend);
    const replicaB = createIntegrationsKit(backend);

    await replicaA.putIntegration('org_a', {
      integration: 'ai',
      provider: 'openai',
      secrets: { apiKey: 'k1' },
    });
    expect(
      (await replicaB.resolveProvider('org_a', 'ai', fromConfig, fromEnv))
        .provider.apiKey,
    ).toBe('k1');

    await replicaA.deleteIntegration('org_a', 'ai');
    // B still has a cached record until it sees the event.
    expect(
      (await replicaB.resolveProvider('org_a', 'ai', fromConfig, fromEnv))
        .source,
    ).toBe('tenant');

    const changed = backend.events.filter(
      (e) => e.topic === INTEGRATION_CHANGED_TOPIC,
    );
    expect(changed.map((e) => e.payload.action)).toEqual(['put', 'delete']);
    replicaB.handleChangedEvent(changed[1]?.payload);
    expect(
      (await replicaB.resolveProvider('org_a', 'ai', fromConfig, fromEnv))
        .source,
    ).toBe('platform');
  });

  test('TTL expiry picks up changes even without an event', async () => {
    const backend = createMemoryIntegrationsBackend();
    let clock = 0;
    const writer = createIntegrationsKit(backend);
    const reader = createIntegrationsKit(backend, {
      ttlMs: 1000,
      now: () => clock,
    });
    expect(
      (await reader.resolveProvider('org_a', 'ai', fromConfig, fromEnv)).source,
    ).toBe('platform');
    await writer.putIntegration('org_a', {
      integration: 'ai',
      provider: 'openai',
      secrets: { apiKey: 'k' },
    });
    expect(
      (await reader.resolveProvider('org_a', 'ai', fromConfig, fromEnv)).source,
    ).toBe('platform');
    clock += 1001;
    expect(
      (await reader.resolveProvider('org_a', 'ai', fromConfig, fromEnv)).source,
    ).toBe('tenant');
  });

  test('reads, events, and audit never leak secret values', async () => {
    const { kit, backend } = setup();
    const view = await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'a@example.com' },
      secrets: { apiKey: SECRET },
      updatedBy: 'admin@example.com',
    });
    expect(view.secrets).toEqual({
      apiKey: { set: true, updatedAt: expect.any(String) },
    });
    const described = await kit.describeIntegration('org_a', 'email.send');
    const listed = await kit.listIntegrations('org_a');
    await kit.recordIntegrationTest('org_a', {
      integration: 'email.send',
      provider: 'resend',
      ok: true,
      source: 'tenant',
    });
    await kit.deleteIntegration('org_a', 'email.send', 'default', 'admin');

    const surfaces = JSON.stringify({
      view,
      described,
      listed,
      records: [...backend.records.values()],
      events: backend.events,
      audit: backend.auditLog,
    });
    expect(surfaces).not.toContain(SECRET);
    expect(backend.auditLog.map((a) => a.action)).toEqual([
      'integration.put',
      'integration.test',
      'integration.delete',
    ]);
    expect(backend.auditLog[0]?.meta).toMatchObject({
      provider: 'resend',
      secretFieldsWritten: ['apiKey'],
    });
    expect(backend.vault.size).toBe(0);
  });

  test('provider change drops secrets that were not re-supplied; null removes a field', async () => {
    const { kit } = setup();
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      secrets: { apiKey: 'k', webhookSecret: 'w' },
    });
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      secrets: { webhookSecret: null },
    });
    expect(
      Object.keys((await kit.getIntegration('org_a', 'email.send'))!.secrets),
    ).toEqual(['apiKey']);
    await kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'cloudflare',
      secrets: { apiToken: 't' },
    });
    expect((await kit.getIntegration('org_a', 'email.send'))!.secrets).toEqual({
      apiToken: 't',
    });
  });

  test('rejects invalid ids', async () => {
    const { kit } = setup();
    await expect(
      kit.putIntegration('org_a', { integration: 'Bad Id', provider: 'x' }),
    ).rejects.toThrow('invalid integration id');
    await expect(
      kit.putIntegration('org_a', {
        integration: 'files.mount',
        instanceId: '../x',
        provider: 's3',
      }),
    ).rejects.toThrow('invalid instance id');
  });
});

describe('http integrations backend', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('uses db-store + secrets with the peer org header; ignores env-fallback secrets', async () => {
    const calls: Array<{ url: string; method: string; org: string | null }> =
      [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        org: headers.get('x-agentos-org-id'),
      });
      if (url.endsWith('/collections/integrations/query')) {
        return Response.json({
          items: [
            {
              id: 'email.send:default',
              data: {
                integration: 'email.send',
                instanceId: 'default',
                provider: 'resend',
                settings: {},
                secretRefs: {
                  apiKey: 'integrations/email.send/default/apiKey',
                  other: 'integrations/email.send/default/other',
                },
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            },
          ],
        });
      }
      if (url.endsWith('apiKey')) {
        return Response.json({ key: 'k', value: 'vault-v', source: 'vault' });
      }
      return Response.json({ key: 'k', value: 'env-v', source: 'env' });
    }) as typeof fetch;

    const kit = createIntegrationsKit(
      createHttpIntegrationsBackend({
        dbStoreApiBase: 'http://db.test',
        secretsApiBase: 'http://secrets.test',
        eventsApiBase: null,
        auditApiBase: null,
      }),
    );
    const resolved = await kit.getIntegration('org_a', 'email.send');
    expect(resolved?.secrets).toEqual({ apiKey: 'vault-v' });
    expect(calls.every((c) => c.org === 'org_a')).toBe(true);
    expect(calls[1]?.url).toBe(
      'http://secrets.test/secrets/integrations%2Femail.send%2Fdefault%2FapiKey',
    );
  });
});

describe('handleIntegrationRoutes', () => {
  const definition: IntegrationDefinition = {
    id: 'email.send',
    label: 'Email sending',
    providers: [
      {
        id: 'resend',
        label: 'Resend',
        settings: [{ name: 'from', label: 'From address', required: true }],
        secrets: [{ name: 'apiKey', label: 'API key', required: true }],
      },
    ],
    platformDefault: () => ({ provider: 'log', configured: true }),
    async test({ config }) {
      if (!config) return { ok: true, message: 'platform ok' };
      return {
        ok: config.secrets.apiKey === 'good',
        message: `rejected key ${config.secrets.apiKey}`,
      };
    },
  };

  function ctx(
    permission: 'ok' | 'denied' = 'ok',
    via: 'session' | 'header' = 'session',
  ): IntegrationRoutesContext & {
    backend: ReturnType<typeof createMemoryIntegrationsBackend>;
  } {
    const backend = createMemoryIntegrationsBackend();
    const checked: string[] = [];
    return {
      backend,
      kit: createIntegrationsKit(backend),
      definitions: [definition],
      resolveOrg: async () => ({
        ok: true,
        orgId: 'org_a',
        via,
        actor: 'admin@example.com',
      }),
      checkPermission: async (_req, perm) => {
        checked.push(perm);
        expect(perm).toBe(PERMISSION_INTEGRATIONS_MANAGE);
        return permission;
      },
    };
  }

  const req = (method: string, path: string, body?: unknown) =>
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: 's=1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  test('returns null for non-integration paths', async () => {
    expect(
      await handleIntegrationRoutes(ctx(), req('GET', '/notify')),
    ).toBeNull();
  });

  test('GET shows platform default; PUT saves; GET never returns the value', async () => {
    const c = ctx();
    const initial = await handleIntegrationRoutes(
      c,
      req('GET', '/integrations/email.send'),
    );
    const initialBody = (await initial!.json()) as Record<string, unknown>;
    expect(initialBody).toMatchObject({
      canManage: true,
      platformDefault: { provider: 'log', configured: true },
      instances: [],
    });

    const missing = await handleIntegrationRoutes(
      c,
      req('PUT', '/integrations/email.send', {
        provider: 'resend',
        settings: { from: 'a@example.com' },
      }),
    );
    expect(missing!.status).toBe(400);

    const put = await handleIntegrationRoutes(
      c,
      req('PUT', '/integrations/email.send', {
        provider: 'resend',
        settings: { from: 'a@example.com' },
        secrets: { apiKey: SECRET },
      }),
    );
    expect(put!.status).toBe(201);
    const putText = await put!.text();
    expect(putText).not.toContain(SECRET);

    // Settings-only update keeps the stored secret.
    const update = await handleIntegrationRoutes(
      c,
      req('PUT', '/integrations/email.send', {
        provider: 'resend',
        settings: { from: 'b@example.com' },
      }),
    );
    expect(update!.status).toBe(200);

    const after = await handleIntegrationRoutes(c, req('GET', '/integrations'));
    const afterText = await after!.text();
    expect(afterText).not.toContain(SECRET);
    expect(JSON.parse(afterText).integrations[0].instances[0]).toMatchObject({
      provider: 'resend',
      settings: { from: 'b@example.com' },
      secrets: { apiKey: { set: true } },
    });
    expect(c.backend.auditLog[0]?.actor).toBe('admin@example.com');
  });

  test('rejects unknown providers, settings, and extra instances', async () => {
    const c = ctx();
    const bad = await handleIntegrationRoutes(
      c,
      req('PUT', '/integrations/email.send', { provider: 'mailchimp' }),
    );
    expect(bad!.status).toBe(400);
    const extra = await handleIntegrationRoutes(
      c,
      req('PUT', '/integrations/email.send', {
        provider: 'resend',
        settings: { from: 'a@example.com', bogus: 'x' },
        secrets: { apiKey: 'k' },
      }),
    );
    expect(extra!.status).toBe(400);
    const instance = await handleIntegrationRoutes(
      c,
      req('PUT', '/integrations/email.send/second', {
        provider: 'resend',
        settings: { from: 'a@example.com' },
        secrets: { apiKey: 'k' },
      }),
    );
    expect(instance!.status).toBe(400);
    const unknown = await handleIntegrationRoutes(
      c,
      req('GET', '/integrations/nope'),
    );
    expect(unknown!.status).toBe(404);
  });

  test('non-managers get a read-only view and 403 on writes', async () => {
    const c = ctx('denied');
    const view = await handleIntegrationRoutes(
      c,
      req('GET', '/integrations/email.send'),
    );
    expect(((await view!.json()) as { canManage: boolean }).canManage).toBe(
      false,
    );
    for (const [method, path] of [
      ['PUT', '/integrations/email.send'],
      ['DELETE', '/integrations/email.send'],
      ['POST', '/integrations/email.send/test'],
    ] as const) {
      const res = await handleIntegrationRoutes(c, req(method, path, {}));
      expect(res!.status).toBe(403);
    }
  });

  test('trusted peer header skips RBAC', async () => {
    const c = ctx('denied', 'header');
    const res = await handleIntegrationRoutes(
      c,
      req('PUT', '/integrations/email.send', {
        provider: 'resend',
        settings: { from: 'a@example.com' },
        secrets: { apiKey: 'k' },
      }),
    );
    expect(res!.status).toBe(201);
  });

  test('test endpoint: platform, saved, and draft; redacts secrets and audits', async () => {
    const c = ctx();
    const platform = await handleIntegrationRoutes(
      c,
      req('POST', '/integrations/email.send/test', {}),
    );
    expect(await platform!.json()).toEqual({
      ok: true,
      source: 'platform',
      message: 'platform ok',
    });

    const draft = await handleIntegrationRoutes(
      c,
      req('POST', '/integrations/email.send/test', {
        provider: 'resend',
        settings: { from: 'a@example.com' },
        secrets: { apiKey: SECRET },
      }),
    );
    const draftText = await draft!.text();
    expect(draftText).not.toContain(SECRET);
    expect(JSON.parse(draftText)).toMatchObject({ ok: false, source: 'draft' });

    await c.kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'a@example.com' },
      secrets: { apiKey: 'good' },
    });
    const saved = await handleIntegrationRoutes(
      c,
      req('POST', '/integrations/email.send/test', {}),
    );
    expect(await saved!.json()).toMatchObject({ ok: true, source: 'tenant' });

    const tests = c.backend.auditLog.filter(
      (a) => a.action === 'integration.test',
    );
    expect(tests.map((t) => t.meta.source)).toEqual([
      'platform',
      'draft',
      'tenant',
    ]);
    expect(JSON.stringify(c.backend.auditLog)).not.toContain(SECRET);
  });

  test('DELETE removes record + secrets', async () => {
    const c = ctx();
    await c.kit.putIntegration('org_a', {
      integration: 'email.send',
      provider: 'resend',
      settings: { from: 'a@example.com' },
      secrets: { apiKey: 'k' },
    });
    const del = await handleIntegrationRoutes(
      c,
      req('DELETE', '/integrations/email.send'),
    );
    expect(await del!.json()).toEqual({ deleted: true });
    expect(c.backend.vault.size).toBe(0);
    const again = await handleIntegrationRoutes(
      c,
      req('DELETE', '/integrations/email.send'),
    );
    expect(again!.status).toBe(404);
  });
});
