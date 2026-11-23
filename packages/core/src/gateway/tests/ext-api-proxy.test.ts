import { describe, expect, test } from 'bun:test';

import {
  createExtApiProxyHandler,
  createExtensionEnableState,
  parseExtApiPath,
  resolveUpstream,
} from '../lib/index';
import type { RegistryModel, ScannedExtension } from '../lib/types';

function ext(
  partial: Pick<ScannedExtension, 'id' | 'kind' | 'toggleable'> &
    Partial<ScannedExtension>,
): ScannedExtension {
  return {
    driven: partial.kind === 'builtin',
    rootDir: `/tmp/${partial.id}`,
    name: partial.id,
    meta: {},
    ui: {},
    uiEntries: {},
    agent: {},
    agentDescriptors: { tools: [], skills: [] },
    ...partial,
  };
}

describe('createExtApiProxyHandler', () => {
  test('forwards headers, blocks disabled, 502 without port', async () => {
    const model: RegistryModel = {
      scannedAt: 1,
      extensions: [
        ext({
          id: 'crm',
          kind: 'customer',
          toggleable: true,
          meta: { api: { language: 'bun', port: 6101 } },
        }),
        ext({
          id: 'auth',
          kind: 'builtin',
          toggleable: false,
          driven: true,
        }),
      ],
    };
    const state = createExtensionEnableState();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const handler = createExtApiProxyHandler(
      () => model,
      state,
      async (url, init) => {
        calls.push({ url, init });
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    const ok = await handler(
      new Request('http://localhost/api/ext/crm/tools/search?limit=2', {
        method: 'POST',
        body: '{"q":"a"}',
        headers: {
          cookie: 'session=abc',
          authorization: 'Bearer tok',
          host: 'localhost:5173',
        },
      }),
    );
    expect(ok?.status).toBe(200);
    expect(calls[0]!.url).toBe('http://127.0.0.1:6101/tools/search?limit=2');
    const fwd = calls[0]!.init?.headers as Headers;
    expect(fwd.get('cookie')).toBe('session=abc');
    expect(fwd.get('authorization')).toBe('Bearer tok');
    expect(fwd.get('host')).toBeNull();

    state.setEnabled('crm', false);
    const blocked = await handler(
      new Request('http://localhost/api/ext/crm/tools/x'),
    );
    expect(blocked?.status).toBe(403);

    const noPort = await handler(
      new Request('http://localhost/api/ext/auth/session'),
    );
    expect(noPort?.status).toBe(502);

    expect(await handler(new Request('http://localhost/api/other'))).toBeNull();
  });

  test('parseExtApiPath keeps query', () => {
    expect(parseExtApiPath('/api/ext/crm/')).toEqual({
      extensionId: 'crm',
      targetPath: '/',
      search: '',
    });
  });

  test('dual Bun+Python: mount routes to service with strip', async () => {
    const dual = ext({
      id: 'questionnaires',
      kind: 'customer',
      toggleable: true,
      meta: {
        api: { language: 'bun', port: 6201 },
        service: {
          root: '../../services/questionnaires',
          port: 6211,
          mount: '/_service',
        },
      },
      service: {
        root: '../../services/questionnaires',
        resolvedRoot: '/tmp/services/questionnaires',
        port: 6211,
        mount: '/_service',
      },
    });
    const model: RegistryModel = { scannedAt: 1, extensions: [dual] };
    const state = createExtensionEnableState();
    const calls: string[] = [];
    const handler = createExtApiProxyHandler(
      () => model,
      state,
      async (url) => {
        calls.push(url);
        return new Response('ok');
      },
    );

    const bunRes = await handler(
      new Request('http://localhost/api/ext/questionnaires/documents'),
    );
    expect(bunRes?.status).toBe(200);
    expect(calls[0]).toBe('http://127.0.0.1:6201/documents');

    const pyRes = await handler(
      new Request('http://localhost/api/ext/questionnaires/_service/health'),
    );
    expect(pyRes?.status).toBe(200);
    expect(calls[1]).toBe('http://127.0.0.1:6211/health');

    const pyRoot = await handler(
      new Request('http://localhost/api/ext/questionnaires/_service'),
    );
    expect(pyRoot?.status).toBe(200);
    expect(calls[2]).toBe('http://127.0.0.1:6211/');
  });

  test('resolveUpstream python-only uses service port', () => {
    const invoices = ext({
      id: 'invoices',
      kind: 'customer',
      toggleable: true,
      meta: {
        api: { language: 'python', port: 6102, root: '../../services/x' },
      },
      service: {
        root: '../../services/x',
        resolvedRoot: '/tmp/x',
        port: 6102,
      },
    });
    expect(resolveUpstream(invoices, '/health')).toEqual({
      port: 6102,
      targetPath: '/health',
    });
  });

  test('streams upstream body without buffering', async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(encoder.encode('data: hello\n\n'));
          return;
        }
        controller.close();
      },
    });

    const model: RegistryModel = {
      scannedAt: 1,
      extensions: [
        ext({
          id: 'events',
          kind: 'builtin',
          toggleable: false,
          driven: true,
          meta: { api: { language: 'bun', port: 6115 } },
        }),
      ],
    };
    const state = createExtensionEnableState();
    const handler = createExtApiProxyHandler(
      () => model,
      state,
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );

    const res = await handler(
      new Request('http://localhost/api/ext/events/subscribe'),
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('text/event-stream');
    expect(res?.body).not.toBeNull();

    const reader = res!.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toBe('data: hello\n\n');
    const second = await reader.read();
    expect(second.done).toBe(true);
  });
});
