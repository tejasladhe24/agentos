import { describe, expect, test } from 'bun:test';
import {
  createIntegrationsKit,
  createMemoryIntegrationsBackend,
  type IntegrationOrgResult,
} from '@agentos/core/api/integrations';

import {
  AI_INTEGRATION_ID,
  createAiIntegrationDefinition,
  createAiModelResolver,
} from '../api/lib/ai-integration';
import { handleAiIntegrationRoutes } from '../api/lib/ai-integration-routes';
import { createAiModels } from '../api/lib/create-model';
import { AI_SOURCE_HEADER, handleAiRequest } from '../api/lib/handle-request';
import type { AiProviderConfig } from '../api/lib/providers';
import type { AiUsageEvent } from '../api/lib/usage-attribution';
import { openaiResponse, post, stubFetch } from './provider-stubs';

const ORG_HEADER = 'x-agentos-org-id';

type HarnessOptions = {
  vectors?: Record<string, number>;
  resolveOrg?: (request: Request) => Promise<IntegrationOrgResult>;
  permission?: 'ok' | 'unauthenticated' | 'denied';
};

/** Wires the AI handler exactly like `server.ts`, with memory + stubbed HTTP. */
function harness(options: HarnessOptions = {}) {
  const provider = stubFetch((url, call) => {
    if (url.endsWith('/models')) {
      return {
        body: {
          data: [
            { id: 'gpt-5-mini' },
            { id: 'text-embedding-3-small' },
            { id: 'gpt-image-1' },
            { id: 'whisper-1' },
          ],
        },
      };
    }
    const auth = call.headers.get('authorization') ?? '';
    if (auth.includes('revoked')) {
      return { status: 401, body: { error: { message: `bad key ${auth}` } } };
    }
    const model = String(call.body?.model ?? '');
    return { body: openaiResponse(`[${model}|${auth}]`, model) };
  });
  const backend = createMemoryIntegrationsBackend();
  const kit = createIntegrationsKit(backend);
  const platform = createAiModels(null);
  const buildModels = (config: AiProviderConfig) =>
    createAiModels(config, { fetch: provider.fetch });
  const resolveOrg =
    options.resolveOrg ??
    (async (request: Request): Promise<IntegrationOrgResult> => {
      const orgId = request.headers.get(ORG_HEADER);
      return orgId
        ? { ok: true, orgId, via: 'header' }
        : { ok: false, status: 401, error: 'org required' };
    });
  const usage: AiUsageEvent[] = [];
  const vectors = options.vectors ?? {};
  const definition = createAiIntegrationDefinition({ platform, buildModels });

  const handle = (request: Request) =>
    handleAiRequest(
      {
        models: platform,
        gatewayUrl: 'http://127.0.0.1:5173',
        resolveModels: createAiModelResolver({
          kit,
          platform,
          buildModels,
          resolveOrgId: async (r) => {
            const org = await resolveOrg(r);
            return org.ok ? org.orgId : null;
          },
        }),
        handleIntegrations: (r) =>
          handleAiIntegrationRoutes(
            {
              kit,
              definition,
              platform,
              resolveOrg,
              checkPermission: async () => options.permission ?? 'ok',
              countVectors: async (orgId) => vectors[orgId] ?? 0,
              fetchImpl: provider.fetch,
            },
            r,
          ),
        recordUsage: (event) => {
          usage.push(event);
        },
      },
      request,
    );

  const putAi = (orgId: string, body: unknown) =>
    handle(
      new Request(`http://127.0.0.1:6113/integrations/${AI_INTEGRATION_ID}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [ORG_HEADER]: orgId },
        body: JSON.stringify(body),
      }),
    );
  const deleteAi = (orgId: string) =>
    handle(
      new Request(`http://127.0.0.1:6113/integrations/${AI_INTEGRATION_ID}`, {
        method: 'DELETE',
        headers: { [ORG_HEADER]: orgId },
      }),
    );
  const generate = (orgId: string | null, prompt = 'hello') =>
    handle(
      post('/generate-text', { prompt }, orgId ? { [ORG_HEADER]: orgId } : {}),
    );

  return { handle, putAi, deleteAi, generate, kit, backend, provider, usage };
}

const orgA = {
  provider: 'openai',
  settings: { model: 'gpt-org-a', embeddingModel: 'text-embedding-3-small' },
  secrets: { apiKey: 'sk-org-a' },
};

async function text(res: Response): Promise<string> {
  return ((await res.json()) as { text: string }).text;
}

describe('ai BYOK per-request models', () => {
  test('org with its own key uses its provider; other orgs use the platform', async () => {
    const h = harness();
    expect((await h.putAi('org_a', orgA)).status).toBe(201);

    const a = await h.generate('org_a');
    expect(a.status).toBe(200);
    expect(a.headers.get(AI_SOURCE_HEADER)).toBe('org');
    expect(await text(a)).toBe('[gpt-org-a|Bearer sk-org-a]');

    const b = await h.generate('org_b');
    expect(b.headers.get(AI_SOURCE_HEADER)).toBe('platform');
    expect(await text(b)).toContain('hello');

    const anon = await h.generate(null);
    expect(anon.headers.get(AI_SOURCE_HEADER)).toBe('platform');
    expect(
      h.provider.calls.filter((c) => c.url.endsWith('/responses')),
    ).toHaveLength(1);
  });

  test('rotating or removing the org key applies without a restart', async () => {
    const h = harness();
    await h.putAi('org_a', orgA);
    expect(await text(await h.generate('org_a'))).toContain('sk-org-a');

    const rotated = await h.putAi('org_a', {
      ...orgA,
      settings: { ...orgA.settings, model: 'gpt-org-a-2' },
      secrets: { apiKey: 'sk-org-a-rotated' },
    });
    expect(rotated.status).toBe(200);
    expect(await text(await h.generate('org_a'))).toBe(
      '[gpt-org-a-2|Bearer sk-org-a-rotated]',
    );

    // same provider + embedding model: kept key, new chat model only
    await h.putAi('org_a', {
      provider: 'openai',
      settings: { ...orgA.settings, model: 'gpt-org-a-3' },
    });
    expect(await text(await h.generate('org_a'))).toBe(
      '[gpt-org-a-3|Bearer sk-org-a-rotated]',
    );

    expect((await h.deleteAi('org_a')).status).toBe(200);
    const after = await h.generate('org_a');
    expect(after.headers.get(AI_SOURCE_HEADER)).toBe('platform');
  });

  test('usage is attributed to org vs platform with provider/model/tokens', async () => {
    const h = harness();
    await h.putAi('org_a', orgA);
    await h.generate('org_a');
    await h.generate('org_b');
    await Bun.sleep(0);
    expect(h.usage).toEqual([
      {
        orgId: 'org_a',
        source: 'org',
        provider: 'openai',
        model: 'gpt-org-a',
        operation: 'generate-text',
        inputTokens: 5,
        outputTokens: 3,
      },
      expect.objectContaining({
        orgId: 'org_b',
        source: 'platform',
        provider: 'mock',
        model: 'mock-text',
        operation: 'generate-text',
      }),
    ]);
  });

  test('a revoked org key surfaces as a provider auth error, never the platform', async () => {
    const h = harness();
    await h.putAi('org_a', { ...orgA, secrets: { apiKey: 'sk-revoked' } });
    const res = await h.generate('org_a');
    expect(res.status).toBe(502);
    expect(res.headers.get(AI_SOURCE_HEADER)).toBe('org');
    const body = await res.text();
    expect(body).toContain('ai_provider_auth');
    expect(body).not.toContain('sk-revoked');
  });
});

describe('ai integration routes', () => {
  test('rejects configs the provider cannot build', async () => {
    const h = harness();
    const anthropicEmbed = await h.putAi('org_a', {
      provider: 'anthropic',
      settings: { model: 'claude-test', embeddingModel: 'x' },
      secrets: { apiKey: 'k' },
    });
    expect(anthropicEmbed.status).toBe(400);
    expect(await anthropicEmbed.text()).toContain('embedding');

    const badUrl = await h.putAi('org_a', {
      ...orgA,
      settings: { ...orgA.settings, baseUrl: 'not a url' },
    });
    expect(badUrl.status).toBe(400);

    const missingKey = await h.putAi('org_a', {
      provider: 'openai',
      settings: { model: 'gpt' },
    });
    expect(missingKey.status).toBe(400);
  });

  test('GET lists the ai definition with platform default and masked key', async () => {
    const h = harness();
    await h.putAi('org_a', orgA);
    const res = await h.handle(
      new Request('http://127.0.0.1:6113/integrations/ai', {
        headers: { [ORG_HEADER]: 'org_a' },
      }),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('sk-org-a');
    const body = JSON.parse(raw) as {
      canManage: boolean;
      definition: { providers: Array<{ id: string }> };
      platformDefault: { provider: string; configured: boolean };
      instances: Array<{ provider: string; secrets: Record<string, unknown> }>;
    };
    expect(body.canManage).toBe(true);
    expect(body.definition.providers.map((p) => p.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'ai-gateway',
    ]);
    expect(body.platformDefault).toEqual({
      provider: 'mock',
      configured: false,
    });
    expect(body.instances[0]?.secrets.apiKey).toMatchObject({ set: true });
  });

  test('test probe runs a short completion on draft and saved configs', async () => {
    const h = harness();
    const draft = await h.handle(
      post('/integrations/ai/test', orgA, { [ORG_HEADER]: 'org_a' }),
    );
    const draftBody = (await draft.json()) as { ok: boolean; message: string };
    expect(draftBody.ok).toBe(true);
    expect(draftBody.message).toContain('openai / gpt-org-a replied');

    const platform = await h.handle(
      post('/integrations/ai/test', {}, { [ORG_HEADER]: 'org_a' }),
    );
    expect(await platform.json()).toMatchObject({
      ok: true,
      source: 'platform',
    });

    const revoked = await h.handle(
      post(
        '/integrations/ai/test',
        { ...orgA, secrets: { apiKey: 'sk-revoked' } },
        { [ORG_HEADER]: 'org_a' },
      ),
    );
    const revokedRaw = await revoked.text();
    expect(JSON.parse(revokedRaw)).toMatchObject({ ok: false });
    expect(revokedRaw).not.toContain('sk-revoked');
  });

  test('model catalog uses the draft key, else the saved org key', async () => {
    const h = harness();
    const withKey = await h.handle(
      post(
        '/integrations/ai/models',
        { provider: 'openai', apiKey: 'sk-draft' },
        { [ORG_HEADER]: 'org_a' },
      ),
    );
    expect(await withKey.json()).toEqual({
      provider: 'openai',
      models: {
        language: ['gpt-5-mini'],
        embedding: ['text-embedding-3-small'],
        image: ['gpt-image-1'],
      },
    });
    expect(h.provider.calls.at(-1)?.headers.get('authorization')).toBe(
      'Bearer sk-draft',
    );

    await h.putAi('org_a', orgA);
    await h.handle(
      post(
        '/integrations/ai/models',
        { provider: 'openai' },
        { [ORG_HEADER]: 'org_a' },
      ),
    );
    expect(h.provider.calls.at(-1)?.headers.get('authorization')).toBe(
      'Bearer sk-org-a',
    );

    const noKey = await h.handle(
      post(
        '/integrations/ai/models',
        { provider: 'anthropic' },
        { [ORG_HEADER]: 'org_a' },
      ),
    );
    expect(noKey.status).toBe(400);
  });

  test('members without integrations.manage cannot write, test, or list models', async () => {
    const h = harness({
      permission: 'denied',
      resolveOrg: async () => ({ ok: true, orgId: 'org_a', via: 'session' }),
    });
    expect((await h.putAi('org_a', orgA)).status).toBe(403);
    expect((await h.handle(post('/integrations/ai/test', orgA))).status).toBe(
      403,
    );
    expect(
      (
        await h.handle(
          post('/integrations/ai/models', { provider: 'openai', apiKey: 'k' }),
        )
      ).status,
    ).toBe(403);
    const view = await h.handle(
      new Request('http://127.0.0.1:6113/integrations/ai'),
    );
    expect(await view.json()).toMatchObject({ canManage: false });
  });
});

describe('ai embedding model guard', () => {
  test('blocks switching the embedding model while the org has vectors', async () => {
    const h = harness({ vectors: { org_a: 3 } });
    const blocked = await h.putAi('org_a', orgA);
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      code: 'ai_embedding_model_locked',
      vectors: 3,
      current: 'mock:mock-embed',
      next: 'openai:text-embedding-3-small',
    });
    expect(h.backend.records.size).toBe(0);

    const textOnly = await h.putAi('org_a', {
      ...orgA,
      settings: { model: 'gpt-org-a' },
    });
    expect(textOnly.status).toBe(201);
  });

  test('allows chat-model changes and blocks reverting to the platform embedder', async () => {
    const locked = harness({ vectors: { org_a: 5 } });
    await locked.kit.putIntegration('org_a', { integration: 'ai', ...orgA });
    const sameEmbedder = await locked.putAi('org_a', {
      ...orgA,
      settings: { ...orgA.settings, model: 'gpt-other' },
    });
    expect(sameEmbedder.status).toBe(200);

    const otherEmbedder = await locked.putAi('org_a', {
      ...orgA,
      settings: { ...orgA.settings, embeddingModel: 'text-embedding-3-large' },
    });
    expect(otherEmbedder.status).toBe(409);

    const removed = await locked.deleteAi('org_a');
    expect(removed.status).toBe(409);

    const status = await locked.handle(
      new Request('http://127.0.0.1:6113/integrations/ai/embedding-status', {
        headers: { [ORG_HEADER]: 'org_a' },
      }),
    );
    expect(await status.json()).toEqual({
      current: 'openai:text-embedding-3-small',
      platform: 'mock:mock-embed',
      vectors: 5,
      locked: true,
    });
    expect(locked.backend.records.size).toBe(1);
  });
});
