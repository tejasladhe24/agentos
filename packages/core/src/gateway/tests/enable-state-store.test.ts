import { describe, expect, test } from 'bun:test';

import {
  applyExtensionEnable,
  createExtensionEnableState,
  createGateway,
  createMemoryEnableStatePersister,
  DEFAULT_DB_STORE_API_BASE,
  gatewayKeys,
  hydrateExtensionEnableState,
  parseEnableOverrides,
  persistExtensionEnableState,
  serializeEnableOverrides,
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
  return { extensions, scannedAt: 1 };
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, init);
}

describe('gatewayKeys', () => {
  test('defaults AGENT_OS_DB_STORE_API_BASE to peer URL', () => {
    const env = gatewayKeys({});
    expect(env.AGENT_OS_DB_STORE_API_BASE).toBe(DEFAULT_DB_STORE_API_BASE);
  });

  test('respects explicit AGENT_OS_DB_STORE_API_BASE', () => {
    const env = gatewayKeys({
      AGENT_OS_DB_STORE_API_BASE: 'http://db.example:6111',
    });
    expect(env.AGENT_OS_DB_STORE_API_BASE).toBe('http://db.example:6111');
  });
});

describe('enable-state-store helpers', () => {
  test('parseEnableOverrides tolerates bad shapes', () => {
    expect(parseEnableOverrides(null)).toEqual({});
    expect(parseEnableOverrides({ enabledById: 'x' })).toEqual({});
    expect(
      parseEnableOverrides({ enabledById: { crm: false, ai: 'no' } }),
    ).toEqual({ crm: false });
  });

  test('serialize / hydrate round-trip retains disables', async () => {
    const persister = createMemoryEnableStatePersister();
    const first = createExtensionEnableState();
    first.setEnabled('crm', false);
    first.setEnabled('invoices', true);
    await persistExtensionEnableState(first, persister);

    expect(persister.snapshot()).toEqual({ crm: false, invoices: true });
    expect(serializeEnableOverrides(first.enabledById)).toEqual({
      crm: false,
      invoices: true,
    });

    const second = createExtensionEnableState();
    await hydrateExtensionEnableState(second, persister);
    expect(second.enabledById.get('crm')).toBe(false);
    expect(second.enabledById.get('invoices')).toBe(true);
  });
});

describe('createGateway enable persistence', () => {
  const registry = modelOf(
    ext({ id: 'crm', kind: 'customer', toggleable: true }),
    ext({
      id: 'auth',
      kind: 'builtin',
      toggleable: false,
      driven: true,
    }),
  );

  test('POST enable persists; new state + GET retain override', async () => {
    const persister = createMemoryEnableStatePersister();
    const enableState = createExtensionEnableState();
    const gateway = createGateway({
      getModel: () => registry,
      enableState,
      enableStatePersister: persister,
      getPublicRoot: () => '/tmp',
      resolveHtmlScriptSrc: () => '',
      serveExtHtml: false,
    });

    const disable = await gateway(
      req('/api/extensions/crm/enable', {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(disable!.status).toBe(200);
    expect(persister.snapshot()).toEqual({ crm: false });

    const reloaded = createExtensionEnableState();
    await hydrateExtensionEnableState(reloaded, persister);
    const gateway2 = createGateway({
      getModel: () => registry,
      enableState: reloaded,
      enableStatePersister: persister,
      getPublicRoot: () => '/tmp',
      resolveHtmlScriptSrc: () => '',
      serveExtHtml: false,
    });

    const getState = await gateway2(req('/api/extensions/enable-state'));
    expect(getState!.status).toBe(200);
    expect(await getState!.json()).toEqual({ enabledById: { crm: false } });

    const crm = registry.extensions.find((e) => e.id === 'crm')!;
    expect(reloaded.isEnabled(crm)).toBe(false);
  });

  test('persist failure rolls back Map and returns 502', async () => {
    const persister = {
      async load() {
        return {};
      },
      async save() {
        throw new Error('db down');
      },
    };
    const enableState = createExtensionEnableState();
    const gateway = createGateway({
      getModel: () => registry,
      enableState,
      enableStatePersister: persister,
      getPublicRoot: () => '/tmp',
      resolveHtmlScriptSrc: () => '',
      serveExtHtml: false,
    });

    const res = await gateway(
      req('/api/extensions/crm/enable', {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(res!.status).toBe(502);
    expect(enableState.enabledById.has('crm')).toBe(false);
    const crm = registry.extensions.find((e) => e.id === 'crm')!;
    expect(enableState.isEnabled(crm)).toBe(true);
  });

  test('locked builtin disable still 403 without writing store', async () => {
    const persister = createMemoryEnableStatePersister();
    const enableState = createExtensionEnableState();
    const gateway = createGateway({
      getModel: () => registry,
      enableState,
      enableStatePersister: persister,
      getPublicRoot: () => '/tmp',
      resolveHtmlScriptSrc: () => '',
      serveExtHtml: false,
    });

    const res = await gateway(
      req('/api/extensions/auth/enable', {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(res!.status).toBe(403);
    expect(persister.snapshot()).toEqual({});
  });

  test('applyExtensionEnable stays locked for builtins', () => {
    const state = createExtensionEnableState();
    const auth = registry.extensions.find((e) => e.id === 'auth')!;
    const result = applyExtensionEnable(auth, false, state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });
});
