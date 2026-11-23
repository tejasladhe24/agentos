import { describe, expect, test } from 'bun:test';

import { createAiModels } from '../api/lib/create-model';
import { handleAiRequest } from '../api/lib/handle-request';

describe('builtin ai server', () => {
  const models = createAiModels();
  const gatewayUrl = 'http://127.0.0.1:5173';

  test('health OK', async () => {
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/health'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'mock' });
  });

  test('generate-text returns mock text', async () => {
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/generate-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain('hello');
  });

  test('generate-text with schema returns structured object', async () => {
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/generate-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'extract COI',
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
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: { summary: string; limit: number };
    };
    expect(body.object.summary).toContain('extract COI');
    expect(typeof body.object.limit).toBe('number');
  });

  test('generate-text with image base64 marks multimodal', async () => {
    // 1x1 PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/generate-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'describe',
          files: [{ base64: pngBase64, mediaType: 'image/png' }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain('describe');
    expect(body.text).toContain('[files:1]');
  });

  test('generate-text with schema + files key resolves via files builtin', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/ext/files/blobs/')) {
        return new Response(
          JSON.stringify({
            key: 'coi.png',
            base64: pngBase64,
            bytes: 68,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const res = await handleAiRequest(
      { models, gatewayUrl, fetchImpl },
      new Request('http://127.0.0.1:6113/generate-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'parse',
          files: [{ key: 'coi.png', mediaType: 'image/png' }],
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              hasFiles: { type: 'boolean' },
              fileCount: { type: 'number' },
            },
            required: ['summary', 'hasFiles', 'fileCount'],
            additionalProperties: false,
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: { summary: string; hasFiles: boolean; fileCount: number };
    };
    expect(body.object.hasFiles).toBe(true);
    expect(body.object.fileCount).toBe(1);
    expect(body.object.summary).toContain('parse');
  });

  test('generate-text rejects oversized / invalid files', async () => {
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/generate-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'x',
          files: [{ base64: 'not-base64!!!', mediaType: 'image/png' }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/base64|invalid/i);
  });

  test('generate-text rejects disallowed media type', async () => {
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/generate-text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'x',
          files: [{ base64: 'YQ==', mediaType: 'text/plain' }],
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not allowed/i);
  });

  test('generate-image returns mock image payload', async () => {
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/generate-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'a cat' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stub: boolean;
      base64: string | null;
    };
    expect(body.stub).toBe(true);
    expect(typeof body.base64).toBe('string');
    expect((body.base64 ?? '').length).toBeGreaterThan(0);
  });

  test('embed returns mock embedding', async () => {
    const res = await handleAiRequest(
      { models, gatewayUrl },
      new Request('http://127.0.0.1:6113/embed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'hello' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      embedding: number[];
      stub: boolean;
    };
    expect(body.stub).toBe(true);
    expect(body.embedding.length).toBeGreaterThan(0);
  });

  test('chat composes instructions and generates text', async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/agent/registry')) {
        return new Response(
          JSON.stringify({
            scannedAt: 1,
            extensions: [
              {
                id: 'crm',
                name: 'CRM',
                instructions: 'Prefer concise CRM answers.',
                tools: [],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const res = await handleAiRequest(
      { models, gatewayUrl, fetchImpl },
      new Request('http://127.0.0.1:6113/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'status?' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain('Prefer concise CRM answers');
    expect(body.text).toContain('status?');
  });

  test('chat runs tools through gateway', async () => {
    const toolCalls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/agent/registry')) {
        return new Response(
          JSON.stringify({
            scannedAt: 1,
            extensions: [
              {
                id: 'crm',
                tools: [{ name: 'search_contacts', method: 'POST' }],
                instructions: '',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/api/ext/crm/tools/search_contacts')) {
        toolCalls.push(url);
        return new Response(JSON.stringify({ contacts: [{ name: 'Ada' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(`unexpected ${url} ${init?.method}`, { status: 500 });
    };

    const res = await handleAiRequest(
      { models, gatewayUrl, fetchImpl },
      new Request('http://127.0.0.1:6113/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: '/tool crm.search_contacts {"q":"Ada"}',
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(toolCalls).toEqual([
      'http://127.0.0.1:5173/api/ext/crm/tools/search_contacts',
    ]);
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain('Ada');
  });
});
