import { afterEach, describe, expect, test } from 'bun:test';

import {
  chat,
  embed,
  generateImage,
  generateText,
  health as aiHealth,
  resolveAiApiBase,
} from '@agentos/core/api/ai';
import {
  appendEntry,
  listEntries,
  resolveAuditApiBase,
} from '@agentos/core/api/audit';
import {
  ack,
  claim,
  publish,
  resolveEventsApiBase,
  scheduleJob,
  subscribeUrl,
} from '@agentos/core/api/events';
import {
  getBlob,
  getBlobBase64,
  deleteBlob,
  listBlobs,
  moveBlob,
  putBlob,
  resolveFilesApiBase,
} from '@agentos/core/api/files';
import {
  createApproval,
  listApprovals,
  resolveApproval,
  resolveHitlApiBase,
} from '@agentos/core/api/hitl';
import {
  getDelivery,
  listRecent,
  notify,
  resolveNotificationsApiBase,
} from '@agentos/core/api/notifications';
import {
  deleteSecret,
  getSecret,
  listSecrets,
  putSecret,
  resolveSecretsApiBase,
} from '@agentos/core/api/secrets';
import { callTool, resolveToolUrl } from '@agentos/core/api/tools';
import {
  deleteVectors,
  health as vectorStoreHealth,
  query as vectorStoreQuery,
  resolveVectorStoreApiBase,
  upsert as vectorStoreUpsert,
} from '@agentos/core/api/vector-store';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Captured = {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
};

function mockFetch(
  handler: (req: Captured) => Response | Promise<Response>,
): void {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    return handler({
      url,
      method,
      body,
      headers: new Headers(init?.headers),
    });
  }) as typeof fetch;
}

describe('resolve*ApiBase', () => {
  test('defaults and overrides', () => {
    expect(resolveAiApiBase({})).toBe('http://127.0.0.1:5173/api/ext/ai');
    expect(resolveHitlApiBase({})).toBe('http://127.0.0.1:5173/api/ext/hitl');
    expect(resolveEventsApiBase({})).toBe(
      'http://127.0.0.1:5173/api/ext/events',
    );
    expect(resolveFilesApiBase({})).toBe('http://127.0.0.1:5173/api/ext/files');
    expect(resolveSecretsApiBase({})).toBe(
      'http://127.0.0.1:5173/api/ext/secrets',
    );
    expect(resolveAuditApiBase({})).toBe('http://127.0.0.1:5173/api/ext/audit');
    expect(resolveNotificationsApiBase({})).toBe(
      'http://127.0.0.1:5173/api/ext/notifications',
    );
    expect(resolveVectorStoreApiBase({})).toBe(
      'http://127.0.0.1:5173/api/ext/vector-store',
    );

    expect(resolveAiApiBase({ AGENT_OS_AI_API_BASE: 'http://ai.test/' })).toBe(
      'http://ai.test',
    );
  });
});

describe('ai client', () => {
  test('generateText / chat / embed / health map paths', async () => {
    const seen: string[] = [];
    mockFetch(({ url, method, body }) => {
      seen.push(`${method} ${url}`);
      if (url.endsWith('/health')) {
        return Response.json({ ok: true, mode: 'mock' });
      }
      if (url.endsWith('/generate-text')) {
        expect(body).toEqual({ prompt: 'hi' });
        return Response.json({ text: 'hello' });
      }
      if (url.endsWith('/generate-image')) {
        return Response.json({
          stub: true,
          mediaType: 'image/png',
          base64: null,
        });
      }
      if (url.endsWith('/embed')) {
        return Response.json({ embedding: [0.1], stub: true });
      }
      if (url.endsWith('/chat')) {
        return Response.json({ text: 'chat', toolNames: [] });
      }
      return new Response('nope', { status: 404 });
    });

    const env = { AGENT_OS_AI_API_BASE: 'http://ai.test' };
    expect(await aiHealth(env)).toEqual({ ok: true, mode: 'mock' });
    expect(await generateText({ prompt: 'hi' }, env)).toEqual({
      text: 'hello',
    });
    expect(await generateImage({ prompt: 'img' }, env)).toEqual({
      stub: true,
      mediaType: 'image/png',
      base64: null,
    });
    expect(await embed({ value: 'x' }, env)).toEqual({
      embedding: [0.1],
      stub: true,
    });
    expect(await chat({ prompt: 'q' }, env)).toEqual({
      text: 'chat',
      toolNames: [],
    });
    expect(seen).toContain('GET http://ai.test/health');
    expect(seen).toContain('POST http://ai.test/generate-text');
  });

  test('generateText forwards schema and files', async () => {
    mockFetch(({ url, body }) => {
      if (url.endsWith('/generate-text')) {
        expect(body).toEqual({
          prompt: 'parse',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
          files: [{ key: 'coi.png', mediaType: 'image/png' }],
        });
        return Response.json({ object: { name: 'Acme' } });
      }
      return new Response('nope', { status: 404 });
    });

    const result = await generateText(
      {
        prompt: 'parse',
        schema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        files: [{ key: 'coi.png', mediaType: 'image/png' }],
      },
      { AGENT_OS_AI_API_BASE: 'http://ai.test' },
    );
    expect(result).toEqual({ object: { name: 'Acme' } });
  });

  test('throws on non-OK', async () => {
    mockFetch(() =>
      Response.json({ error: 'prompt required' }, { status: 400 }),
    );
    await expect(
      generateText({ prompt: '' }, { AGENT_OS_AI_API_BASE: 'http://ai.test' }),
    ).rejects.toThrow(/ai generate-text failed \(400\)/);
  });
});

describe('hitl client', () => {
  test('list / create / resolve', async () => {
    const approval = {
      id: 'a1',
      title: 'Ship',
      status: 'pending' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    mockFetch(({ url, method, body }) => {
      if (method === 'GET' && url.includes('/approvals')) {
        expect(url).toContain('status=pending');
        return Response.json({ approvals: [approval] });
      }
      if (method === 'POST' && url.endsWith('/approvals')) {
        expect(body).toEqual({ title: 'Ship' });
        return Response.json(approval, { status: 201 });
      }
      if (method === 'POST' && url.endsWith('/resolve')) {
        expect(body).toEqual({ decision: 'approved' });
        return Response.json({ ...approval, status: 'approved' });
      }
      return new Response('nope', { status: 404 });
    });

    const env = { AGENT_OS_HITL_API_BASE: 'http://hitl.test' };
    expect(await listApprovals('pending', env)).toEqual([approval]);
    expect(await createApproval({ title: 'Ship' }, env)).toEqual(approval);
    expect(await resolveApproval('a1', 'approved', env)).toEqual({
      ...approval,
      status: 'approved',
    });
  });
});

describe('events client', () => {
  test('publish and subscribeUrl', async () => {
    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://events.test/publish');
      expect(body).toEqual({ topic: 'orders', payload: { id: 1 } });
      return Response.json({
        ok: true,
        event: {
          id: 'e1',
          topic: 'orders',
          payload: { id: 1 },
          at: '2026-01-01T00:00:00.000Z',
        },
      });
    });

    const env = { AGENT_OS_EVENTS_API_BASE: 'http://events.test' };
    const result = await publish('orders', { id: 1 }, env);
    expect(result.ok).toBe(true);
    expect(subscribeUrl('orders', env)).toBe(
      'http://events.test/subscribe?topic=orders',
    );
    expect(subscribeUrl(['a', 'b'], env)).toBe(
      'http://events.test/subscribe?topics=a&topics=b',
    );
  });

  test('claim / ack / scheduleJob', async () => {
    mockFetch(({ url, method, body }) => {
      if (url.endsWith('/queue/claim')) {
        expect(method).toBe('POST');
        expect(body).toEqual({ limit: 2 });
        return Response.json({
          messages: [
            {
              id: 'm1',
              topic: 'orders',
              payload: {},
              status: 'leased',
              attempts: 0,
              availableAt: '2026-01-01T00:00:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
      }
      if (url.endsWith('/queue/ack')) {
        expect(body).toEqual({ id: 'm1' });
        return Response.json({
          message: {
            id: 'm1',
            topic: 'orders',
            payload: {},
            status: 'acked',
            attempts: 0,
            availableAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        });
      }
      if (url.endsWith('/jobs')) {
        expect(body).toMatchObject({
          kind: 'cron',
          cron: '@every 30s',
          action: 'publish',
          topic: 'heartbeat',
        });
        return Response.json({
          id: 'j1',
          kind: 'cron',
          cron: '@every 30s',
          action: 'publish',
          topic: 'heartbeat',
          enabled: true,
          nextRunAt: '2026-01-01T00:00:30.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        });
      }
      return new Response('unexpected', { status: 500 });
    });

    const env = { AGENT_OS_EVENTS_API_BASE: 'http://events.test' };
    expect(await claim(2, env)).toMatchObject({
      messages: [{ id: 'm1', status: 'leased' }],
    });
    expect(await ack('m1', env)).toMatchObject({
      message: { id: 'm1', status: 'acked' },
    });
    expect(
      await scheduleJob(
        {
          kind: 'cron',
          cron: '@every 30s',
          action: 'publish',
          topic: 'heartbeat',
        },
        env,
      ),
    ).toMatchObject({ id: 'j1', topic: 'heartbeat' });
  });
});

describe('files client', () => {
  test('putBlob base64 / getBlob / getBlobBase64 / deleteBlob', async () => {
    mockFetch(({ url, method, body, headers }) => {
      if (method === 'PUT') {
        expect(url).toBe('http://files.test/blobs/doc%2F1');
        expect(headers.get('content-type')).toContain('application/json');
        expect(body).toEqual({ base64: 'YQ==' });
        return Response.json({ ok: true, key: 'doc/1', bytes: 1 });
      }
      if (method === 'DELETE') {
        expect(url).toBe('http://files.test/blobs/doc%2F1');
        return Response.json({ ok: true, key: 'doc/1' });
      }
      if (method === 'GET' && url.includes('format=json')) {
        return Response.json({ key: 'doc/1', base64: 'YQ==', bytes: 1 });
      }
      if (method === 'GET') {
        return new Response(new Uint8Array([97]), {
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      return new Response('nope', { status: 404 });
    });

    const env = { AGENT_OS_FILES_API_BASE: 'http://files.test' };
    expect(await putBlob('doc/1', 'YQ==', env)).toEqual({
      ok: true,
      key: 'doc/1',
      bytes: 1,
    });
    expect(await getBlobBase64('doc/1', env)).toEqual({
      key: 'doc/1',
      base64: 'YQ==',
      bytes: 1,
    });
    const bytes = await getBlob('doc/1', env);
    expect([...bytes]).toEqual([97]);
    expect(await deleteBlob('doc/1', env)).toEqual({ ok: true, key: 'doc/1' });
  });

  test('listBlobs / moveBlob with org header', async () => {
    mockFetch(({ url, method, body, headers }) => {
      expect(headers.get('x-agentos-org-id')).toBe('org1');
      if (method === 'GET' && url.startsWith('http://files.test/blobs')) {
        return Response.json({
          items: [
            {
              key: 'orgs/org1/doc/1',
              name: '1',
              kind: 'file',
              relativeKey: 'doc/1',
            },
          ],
          cursor: null,
          prefix: '',
        });
      }
      if (method === 'POST' && url.endsWith('/blobs/move')) {
        expect(body).toEqual({ from: 'a', to: 'b' });
        return Response.json({ ok: true, from: 'a', to: 'b' });
      }
      return new Response('nope', { status: 404 });
    });

    const env = { AGENT_OS_FILES_API_BASE: 'http://files.test' };
    expect(await listBlobs({}, env, { orgId: 'org1' })).toMatchObject({
      items: [{ name: '1', kind: 'file' }],
    });
    expect(await moveBlob('a', 'b', env, { orgId: 'org1' })).toEqual({
      ok: true,
      from: 'a',
      to: 'b',
    });
  });
});

describe('audit client', () => {
  test('appendEntry and listEntries', async () => {
    const env = { AGENT_OS_AUDIT_API_BASE: 'http://audit.test' };
    const entry = {
      id: 'a1',
      action: 'doc.view',
      actor: 'u1',
      resource: 'doc/1',
      at: '2026-01-01T00:00:00.000Z',
    };

    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://audit.test/entries');
      expect(body).toEqual({
        action: 'doc.view',
        actor: 'u1',
        resource: 'doc/1',
      });
      return Response.json(entry, { status: 201 });
    });
    expect(
      await appendEntry(
        { action: 'doc.view', actor: 'u1', resource: 'doc/1' },
        env,
      ),
    ).toEqual(entry);

    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toBe('http://audit.test/entries?limit=10');
      return Response.json({ entries: [entry] });
    });
    expect(await listEntries(10, env)).toEqual({ entries: [entry] });
  });
});

describe('notifications client', () => {
  test('notify / listRecent / getDelivery forward orgId', async () => {
    const env = { AGENT_OS_NOTIFICATIONS_API_BASE: 'http://notify.test' };
    const notification = {
      id: 'n1',
      message: 'hello',
      type: 'info' as const,
      channel: 'email' as const,
      status: 'sent' as const,
      at: '2026-01-01T00:00:00.000Z',
      to: 'a@b.co',
      orgId: 'org_1',
    };

    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://notify.test/notify');
      expect(body).toEqual({
        channel: 'email',
        message: 'hello',
        to: 'a@b.co',
      });
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({ ok: true, notification });
    });
    expect(
      await notify({ channel: 'email', message: 'hello', to: 'a@b.co' }, env, {
        orgId: 'org_1',
      }),
    ).toEqual({ ok: true, notification });

    mockFetch(({ url, method, headers }) => {
      expect(method).toBe('GET');
      expect(url).toBe('http://notify.test/recent');
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({ notifications: [notification] });
    });
    expect(await listRecent(env, { orgId: 'org_1' })).toEqual([notification]);

    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toBe('http://notify.test/deliveries/n1');
      return Response.json({ notification });
    });
    expect(await getDelivery('n1', env)).toEqual(notification);
  });
});

describe('secrets client', () => {
  test('getSecret', async () => {
    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toBe('http://secrets.test/secrets/OPENAI_KEY');
      return Response.json({ key: 'OPENAI_KEY', value: 'sk-test' });
    });
    expect(
      await getSecret('OPENAI_KEY', {
        AGENT_OS_SECRETS_API_BASE: 'http://secrets.test',
      }),
    ).toEqual({ key: 'OPENAI_KEY', value: 'sk-test' });
  });

  test('listSecrets forwards orgId and returns metadata', async () => {
    const env = { AGENT_OS_SECRETS_API_BASE: 'http://secrets.test' };
    mockFetch(({ url, method, headers }) => {
      expect(method).toBe('GET');
      expect(url).toBe('http://secrets.test/secrets');
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({
        orgId: 'org_1',
        canWrite: true,
        keys: [{ key: 'qbo', updatedAt: 't', hasValue: true }],
      });
    });
    expect(await listSecrets(env, { orgId: 'org_1' })).toEqual({
      orgId: 'org_1',
      canWrite: true,
      keys: [{ key: 'qbo', updatedAt: 't', hasValue: true }],
    });
  });

  test('putSecret and deleteSecret forward orgId', async () => {
    const env = { AGENT_OS_SECRETS_API_BASE: 'http://secrets.test' };

    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('PUT');
      expect(url).toBe('http://secrets.test/secrets/qbo');
      expect(body).toEqual({ value: 'tok', expiresAt: '2030-01-01T00:00:00Z' });
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({
        key: 'qbo',
        rotatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
      });
    });
    expect(
      await putSecret(
        'qbo',
        { value: 'tok', expiresAt: '2030-01-01T00:00:00Z' },
        env,
        { orgId: 'org_1' },
      ),
    ).toMatchObject({ key: 'qbo', version: 1 });

    mockFetch(({ url, method, headers }) => {
      expect(method).toBe('DELETE');
      expect(url).toBe('http://secrets.test/secrets/qbo');
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({ key: 'qbo', deleted: true });
    });
    expect(await deleteSecret('qbo', env, { orgId: 'org_1' })).toEqual({
      key: 'qbo',
      deleted: true,
    });
  });
});

describe('vector-store client', () => {
  test('health, upsert, query, deleteVectors forward orgId', async () => {
    const env = { AGENT_OS_VECTOR_STORE_API_BASE: 'http://vs.test' };

    mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toBe('http://vs.test/health');
      return Response.json({ ok: true, mode: 'memory', dimensions: 4 });
    });
    expect(await vectorStoreHealth(env)).toEqual({
      ok: true,
      mode: 'memory',
      dimensions: 4,
    });

    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://vs.test/indexes/policies/upsert');
      expect(body).toEqual({
        items: [{ id: 'c1', embedding: [1, 0, 0, 0], content: 'a' }],
      });
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({ upserted: 1 });
    });
    expect(
      await vectorStoreUpsert(
        'policies',
        { items: [{ id: 'c1', embedding: [1, 0, 0, 0], content: 'a' }] },
        { env, orgId: 'org_1' },
      ),
    ).toEqual({ upserted: 1 });

    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://vs.test/indexes/policies/query');
      expect(body).toEqual({ embedding: [1, 0, 0, 0], topK: 3 });
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({
        items: [{ id: 'c1', score: 0.99, content: 'a' }],
      });
    });
    expect(
      await vectorStoreQuery(
        'policies',
        { embedding: [1, 0, 0, 0], topK: 3 },
        { env, orgId: 'org_1' },
      ),
    ).toEqual({ items: [{ id: 'c1', score: 0.99, content: 'a' }] });

    mockFetch(({ url, method, body, headers }) => {
      expect(method).toBe('POST');
      expect(url).toBe('http://vs.test/indexes/policies/delete');
      expect(body).toEqual({ ids: ['c1'] });
      expect(headers.get('x-agentos-org-id')).toBe('org_1');
      return Response.json({ deleted: 1 });
    });
    expect(
      await deleteVectors('policies', { ids: ['c1'] }, { env, orgId: 'org_1' }),
    ).toEqual({ deleted: 1 });
  });
});

describe('tools client', () => {
  test('resolveToolUrl and callTool', async () => {
    expect(
      resolveToolUrl('crm-helper', 'search_contacts', {
        AGENT_OS_GLOBAL_GATEWAY_URL: 'http://gw.test',
      }),
    ).toBe('http://gw.test/api/ext/crm-helper/tools/search_contacts');

    mockFetch(({ url, method, body }) => {
      expect(method).toBe('POST');
      expect(url).toBe(
        'http://gw.test/api/ext/crm-helper/tools/search_contacts',
      );
      expect(body).toEqual({ q: 'ada' });
      return Response.json({ items: [] });
    });

    expect(
      await callTool(
        'crm-helper',
        'search_contacts',
        { q: 'ada' },
        { AGENT_OS_GLOBAL_GATEWAY_URL: 'http://gw.test' },
      ),
    ).toEqual({ items: [] });
  });
});
