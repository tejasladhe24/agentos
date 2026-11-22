import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createExtensionEnableState,
  createGateway,
  parseExtApiPath,
  parseExtensionEnablePath,
  parsePublicAssetPath,
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

function modelOf(...extensions: ScannedExtension[]): RegistryModel {
  return { extensions, scannedAt: 42 };
}

function req(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`http://localhost${path}`, init);
}

describe('path parsers (fetch layer)', () => {
  test('parsePublicAssetPath / parseExtensionEnablePath / parseExtApiPath', () => {
    expect(parsePublicAssetPath('/_public/logo.svg')).toBe('logo.svg');
    expect(parseExtensionEnablePath('/api/extensions/crm/enable')).toEqual({
      extensionId: 'crm',
    });
    expect(parseExtApiPath('/api/ext/crm/tools?q=1')).toEqual({
      extensionId: 'crm',
      targetPath: '/tools',
      search: '?q=1',
    });
  });
});

describe('createGateway', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('serves public assets, enable, agent registry, proxy, and html', async () => {
    const publicRoot = mkdtempSync(join(tmpdir(), 'agentos-gw-public-'));
    temps.push(publicRoot);
    writeFileSync(join(publicRoot, 'logo.svg'), '<svg id="g" />');

    const registry = modelOf(
      ext({
        id: 'crm',
        kind: 'customer',
        toggleable: true,
        name: 'CRM',
        meta: { api: { language: 'bun', port: 6101 } },
        ui: { page: '/tmp/crm/ui/page.tsx' },
        agentDescriptors: {
          tools: [{ name: 'search' }],
          skills: ['s1'],
        },
      }),
      ext({
        id: 'ai',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        meta: { api: { language: 'bun', port: 7101 } },
      }),
    );
    const enableState = createExtensionEnableState();
    const calls: string[] = [];
    const gateway = createGateway({
      getModel: () => registry,
      enableState,
      getPublicRoot: () => publicRoot,
      resolveHtmlScriptSrc: (id, view) => `/built/${id}/${view}.js`,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const asset = await gateway(req('/_public/logo.svg'));
    expect(asset?.status).toBe(200);
    expect(await asset!.text()).toContain('id="g"');

    const missingAsset = await gateway(req('/_public/missing.png'));
    expect(missingAsset?.status).toBe(404);
    expect(await missingAsset!.text()).toContain('Not Found');

    const disable = await gateway(
      req('/api/extensions/crm/enable', {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(disable?.status).toBe(200);
    expect(await disable!.json()).toEqual({ id: 'crm', enabled: false });

    const registryRes = await gateway(req('/api/agent/registry'));
    expect(registryRes?.status).toBe(200);
    const body = (await registryRes!.json()) as {
      extensions: Array<{ id: string }>;
    };
    expect(body.extensions.map((e) => e.id)).toEqual(['ai']);

    const blocked = await gateway(req('/api/ext/crm/tools/x'));
    expect(blocked?.status).toBe(403);

    enableState.setEnabled('crm', true);
    const proxied = await gateway(
      req('/api/ext/crm/tools/search?limit=1', {
        method: 'POST',
        body: '{}',
        headers: { cookie: 's=1', authorization: 'Bearer t' },
      }),
    );
    expect(proxied?.status).toBe(200);
    expect(calls[0]).toBe('http://127.0.0.1:6101/tools/search?limit=1');

    const chat = await gateway(
      req('/api/agent/chat', { method: 'POST', body: '{}' }),
    );
    expect(chat?.status).toBe(200);
    expect(calls[1]).toBe('http://127.0.0.1:7101/chat');

    const html = await gateway(req('/__agentos/ext/crm/page.html'));
    expect(html?.status).toBe(200);
    expect(await html!.text()).toContain('/built/crm/page.js');

    expect(await gateway(req('/spa'))).toBeNull();
  });

  test('rejects disable of locked extensions at fetch layer', async () => {
    const registry = modelOf(
      ext({ id: 'auth', kind: 'builtin', toggleable: false, driven: true }),
    );
    const gateway = createGateway({
      getModel: () => registry,
      enableState: createExtensionEnableState(),
      getPublicRoot: () => '/tmp',
      resolveHtmlScriptSrc: () => '/x.js',
    });

    const res = await gateway(
      req('/api/extensions/auth/enable', {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { error: string }).error).toContain(
      'driven',
    );
  });
});
