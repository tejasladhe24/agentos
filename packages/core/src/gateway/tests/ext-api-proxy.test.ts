import { describe, expect, test } from 'bun:test';

import {
  createExtApiProxyHandler,
  createExtensionEnableState,
  parseExtApiPath,
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
    expect(calls[0]!.url).toBe(
      'http://127.0.0.1:6101/tools/search?limit=2',
    );
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

    expect(
      await handler(new Request('http://localhost/api/other')),
    ).toBeNull();
  });

  test('parseExtApiPath keeps query', () => {
    expect(parseExtApiPath('/api/ext/crm/')).toEqual({
      extensionId: 'crm',
      targetPath: '/',
      search: '',
    });
  });
});
