import { beforeEach, describe, expect, test } from 'bun:test';

import { aiConfigFromEnv, keys } from '../api/env';
import {
  clearAiModelCache,
  createAiModels,
  getCachedAiModels,
} from '../api/lib/create-model';
import type { FetchLike } from '../api/lib/fetch-like';
import { handleAiRequest } from '../api/lib/handle-request';
import {
  AiConfigError,
  aiConfigHash,
  type AiProviderConfig,
} from '../api/lib/providers';

type Captured = { url: string; body: Record<string, unknown> | null };

function stubFetch(
  respond: (url: string) => { status?: number; body: unknown },
): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const raw = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, body: raw ? JSON.parse(raw) : null });
    const { status = 200, body } = respond(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchImpl, calls };
}

const openaiResponse = (text: string) => ({
  id: 'resp_1',
  object: 'response',
  created_at: 1_700_000_000,
  status: 'completed',
  model: 'gpt-test',
  incomplete_details: null,
  output: [
    {
      type: 'message',
      id: 'msg_1',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  ],
  usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
});

const post = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1:6113${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const gatewayUrl = 'http://127.0.0.1:5173';

const openaiConfig: AiProviderConfig = {
  provider: 'openai',
  apiKey: 'sk-test',
  model: 'gpt-test',
  embeddingModel: 'text-embedding-3-small',
};

describe('createAiModels provider factory', () => {
  beforeEach(() => clearAiModelCache());

  test('no config → mock suite', () => {
    const models = createAiModels(null);
    expect(models.mode).toBe('mock');
    expect(models.provider).toBe('mock');
  });

  test.each([
    ['openai', 'gpt-test', 'openai'],
    ['anthropic', 'claude-sonnet-4-5', 'anthropic'],
    ['google', 'gemini-test', 'google'],
    ['ai-gateway', 'openai/gpt-test', 'gateway'],
  ] as const)('%s builds the matching SDK provider', (provider, model, sdk) => {
    const models = createAiModels({ provider, apiKey: 'k', model });
    expect(models.mode).toBe('configured');
    expect(models.provider).toBe(provider);
    const language = models.language as { provider: string; modelId: string };
    expect(language.provider.startsWith(sdk)).toBe(true);
    expect(language.modelId).toBe(model);
  });

  test('embedding / image models only when configured and supported', () => {
    const openai = createAiModels({
      ...openaiConfig,
      imageModel: 'gpt-image-1',
    });
    expect(openai.embedding).not.toBeNull();
    expect(openai.image).not.toBeNull();
    expect(openai.embeddingModel).toBe('text-embedding-3-small');

    const bare = createAiModels({
      provider: 'google',
      apiKey: 'k',
      model: 'm',
    });
    expect(bare.embedding).toBeNull();
    expect(bare.image).toBeNull();
  });

  test('anthropic rejects embedding / image models', () => {
    expect(() =>
      createAiModels({
        provider: 'anthropic',
        apiKey: 'k',
        model: 'claude',
        embeddingModel: 'x',
      }),
    ).toThrow(AiConfigError);
    expect(() =>
      createAiModels({
        provider: 'anthropic',
        apiKey: 'k',
        model: 'claude',
        imageModel: 'x',
      }),
    ).toThrow(/does not offer image models/);
  });

  test('cache returns the same models per config hash', () => {
    const a = getCachedAiModels(openaiConfig);
    const b = getCachedAiModels({ ...openaiConfig });
    const c = getCachedAiModels({ ...openaiConfig, apiKey: 'sk-other' });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(aiConfigHash(openaiConfig)).not.toContain('sk-test');
  });
});

describe('aiConfigFromEnv', () => {
  test('unset / mock provider → null', () => {
    expect(aiConfigFromEnv(keys({}))).toBeNull();
    expect(
      aiConfigFromEnv(
        keys({ AGENT_OS_EXT_AI_PROVIDER: 'mock', AGENT_OS_EXT_AI_MODEL: 'x' }),
      ),
    ).toBeNull();
  });

  test('builds config from env', () => {
    const config = aiConfigFromEnv(
      keys({
        AGENT_OS_EXT_AI_PROVIDER: 'ai-gateway',
        AGENT_OS_EXT_AI_API_KEY: 'gw-key',
        AGENT_OS_EXT_AI_MODEL: 'anthropic/claude-test',
        AGENT_OS_EXT_AI_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
        AGENT_OS_EXT_AI_BASE_URL: 'https://gateway.example.com/v3/ai',
        AGENT_OS_EXT_AI_ZERO_DATA_RETENTION: 'true',
      }),
    );
    expect(config).toEqual({
      provider: 'ai-gateway',
      apiKey: 'gw-key',
      model: 'anthropic/claude-test',
      embeddingModel: 'openai/text-embedding-3-small',
      baseUrl: 'https://gateway.example.com/v3/ai',
      zeroDataRetention: true,
    });
  });

  test('provider without key or model is a config error', () => {
    expect(() =>
      aiConfigFromEnv(
        keys({
          AGENT_OS_EXT_AI_PROVIDER: 'openai',
          AGENT_OS_EXT_AI_MODEL: 'm',
        }),
      ),
    ).toThrow(/AGENT_OS_EXT_AI_API_KEY is required/);
    expect(() =>
      aiConfigFromEnv(
        keys({
          AGENT_OS_EXT_AI_PROVIDER: 'openai',
          AGENT_OS_EXT_AI_API_KEY: 'k',
        }),
      ),
    ).toThrow(/AGENT_OS_EXT_AI_MODEL is required/);
  });

  test('unknown provider fails env validation', () => {
    expect(() => keys({ AGENT_OS_EXT_AI_PROVIDER: 'cohere' })).toThrow();
  });
});

describe('configured ai server (mocked provider HTTP)', () => {
  test('health reports provider + capabilities', async () => {
    const models = createAiModels({
      provider: 'anthropic',
      apiKey: 'k',
      model: 'claude-sonnet-4-5',
    });
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/health'),
    );
    expect(await res.json()).toEqual({
      ok: true,
      mode: 'configured',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      capabilities: { language: true, embedding: false, image: false },
    });
  });

  test('openai generate-text sends store:false and returns text', async () => {
    const stub = stubFetch(() => ({
      body: openaiResponse('Hello from OpenAI'),
    }));
    const models = createAiModels(openaiConfig, { fetch: stub.fetch });
    const res = await handleAiRequest(
      { models, gatewayUrl },
      post('/generate-text', { prompt: 'hi' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Hello from OpenAI' });
    expect(stub.calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(stub.calls[0]?.body?.store).toBe(false);
    expect(stub.calls[0]?.body?.model).toBe('gpt-test');
  });

  test('openai structured output parses the JSON response', async () => {
    const stub = stubFetch(() => ({
      body: openaiResponse(JSON.stringify({ summary: 'ok', limit: 3 })),
    }));
    const models = createAiModels(openaiConfig, { fetch: stub.fetch });
    const res = await handleAiRequest(
      { models, gatewayUrl },
      post('/generate-text', {
        prompt: 'extract',
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['summary', 'limit'],
          additionalProperties: false,
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ object: { summary: 'ok', limit: 3 } });
  });

  test('openai embed hits embeddings endpoint', async () => {
    const stub = stubFetch(() => ({
      body: {
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      },
    }));
    const models = createAiModels(openaiConfig, { fetch: stub.fetch });
    const res = await handleAiRequest(
      { models, gatewayUrl },
      post('/embed', { value: 'hello' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ embedding: [0.1, 0.2], stub: false });
    expect(stub.calls[0]?.url).toBe('https://api.openai.com/v1/embeddings');
  });

  test('base URL override is used', async () => {
    const stub = stubFetch(() => ({ body: openaiResponse('eu') }));
    const models = createAiModels(
      { ...openaiConfig, baseUrl: 'https://eu.api.openai.com/v1' },
      { fetch: stub.fetch },
    );
    await handleAiRequest(
      { models, gatewayUrl },
      post('/generate-text', { prompt: 'hi' }),
    );
    expect(stub.calls[0]?.url).toBe('https://eu.api.openai.com/v1/responses');
  });

  test('anthropic chat returns text', async () => {
    const stub = stubFetch(() => ({
      body: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Hello from Claude' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 2 },
      },
    }));
    const models = createAiModels(
      { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-5' },
      { fetch: stub.fetch },
    );
    const res = await handleAiRequest(
      { models, gatewayUrl },
      post('/chat', { prompt: 'hi', registry: { extensions: [] } }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toBe(
      'Hello from Claude',
    );
    expect(stub.calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
  });

  test('google generate-text returns text', async () => {
    const stub = stubFetch(() => ({
      body: {
        candidates: [
          {
            content: { parts: [{ text: 'Hello from Gemini' }], role: 'model' },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 1,
          totalTokenCount: 2,
        },
      },
    }));
    const models = createAiModels(
      { provider: 'google', apiKey: 'k', model: 'gemini-test' },
      { fetch: stub.fetch },
    );
    const res = await handleAiRequest(
      { models, gatewayUrl },
      post('/generate-text', { prompt: 'hi' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Hello from Gemini' });
    expect(stub.calls[0]?.url).toContain('models/gemini-test:generateContent');
  });

  test('unsupported capability → 501 without calling the provider', async () => {
    const stub = stubFetch(() => ({ body: {} }));
    const models = createAiModels(
      { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-4-5' },
      { fetch: stub.fetch },
    );
    const embed = await handleAiRequest(
      { models, gatewayUrl },
      post('/embed', { value: 'x' }),
    );
    expect(embed.status).toBe(501);
    expect(await embed.json()).toMatchObject({
      code: 'ai_capability_unsupported',
      provider: 'anthropic',
    });
    const image = await handleAiRequest(
      { models, gatewayUrl },
      post('/generate-image', { prompt: 'x' }),
    );
    expect(image.status).toBe(501);
    expect(stub.calls).toHaveLength(0);
  });

  test('bad key → 502 ai_provider_auth without leaking the key', async () => {
    const stub = stubFetch(() => ({
      status: 401,
      body: {
        error: {
          message: 'Incorrect API key provided: sk-test',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
    }));
    const models = createAiModels(openaiConfig, { fetch: stub.fetch });
    const res = await handleAiRequest(
      { models, gatewayUrl },
      post('/generate-text', { prompt: 'hi' }),
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('ai_provider_auth');
    expect(body.error).not.toContain('sk-test');
    expect(stub.calls).toHaveLength(1);
  });
});
