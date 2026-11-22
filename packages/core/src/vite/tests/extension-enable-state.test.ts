import { describe, expect, test } from 'bun:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createExtensionEnableMiddleware,
  createExtensionEnableState,
  parseExtensionEnablePath,
} from '@agentos/core/vite/lib/extension-enable-state';
import type {
  RegistryModel,
  ScannedExtension,
} from '@agentos/core/vite/lib/types';

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
  return { extensions, scannedAt: Date.now() };
}

function mockReqRes(
  url: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const req = {
    method: options.method ?? 'GET',
    url,
    headers: options.headers ?? {},
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
      if (event === 'end' && options.body !== undefined) {
        queueMicrotask(() => {
          for (const fn of listeners.data ?? []) {
            fn(Buffer.from(options.body!));
          }
          for (const fn of listeners.end ?? []) {
            fn();
          }
        });
      } else if (event === 'end' && options.body === undefined) {
        queueMicrotask(() => {
          for (const fn of listeners.end ?? []) {
            fn();
          }
        });
      }
      return req;
    },
  } as unknown as IncomingMessage;

  const res = {
    set statusCode(code: number) {
      statusCode = code;
    },
    get statusCode() {
      return statusCode;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(body?: string | Buffer) {
      if (body != null) {
        chunks.push(typeof body === 'string' ? Buffer.from(body) : body);
      }
    },
  } as unknown as ServerResponse;

  return {
    req,
    res,
    get body() {
      return Buffer.concat(chunks).toString('utf8');
    },
    get status() {
      return statusCode;
    },
    get headers() {
      return headers;
    },
    async settle() {
      await new Promise((r) => queueMicrotask(r));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('parseExtensionEnablePath', () => {
  test('parses enable path', () => {
    expect(parseExtensionEnablePath('/api/extensions/crm/enable')).toEqual({
      extensionId: 'crm',
    });
    expect(parseExtensionEnablePath('/api/extensions/crm/enable/')).toEqual({
      extensionId: 'crm',
    });
    expect(parseExtensionEnablePath('/api/ext/crm/tools')).toBeNull();
  });
});

describe('createExtensionEnableState', () => {
  test('builtins always enabled; customers default enabled', () => {
    const state = createExtensionEnableState();
    const auth = ext({ id: 'auth', kind: 'builtin', toggleable: false });
    const crm = ext({ id: 'crm', kind: 'customer', toggleable: true });

    expect(state.isEnabled(auth)).toBe(true);
    expect(state.isEnabled(crm)).toBe(true);

    state.setEnabled('auth', false);
    state.setEnabled('crm', false);
    expect(state.isEnabled(auth)).toBe(true);
    expect(state.isEnabled(crm)).toBe(false);
  });
});

describe('createExtensionEnableMiddleware', () => {
  test('disables customer and rejects builtin disable', async () => {
    const registry = modelOf(
      ext({ id: 'crm', kind: 'customer', toggleable: true }),
      ext({ id: 'auth', kind: 'builtin', toggleable: false }),
    );
    const state = createExtensionEnableState();
    const mw = createExtensionEnableMiddleware(() => registry, state);

    const disableCrm = mockReqRes('/api/extensions/crm/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
      headers: { 'content-type': 'application/json' },
    });
    mw(disableCrm.req, disableCrm.res, () => {});
    await disableCrm.settle();
    expect(disableCrm.status).toBe(200);
    expect(JSON.parse(disableCrm.body)).toEqual({
      id: 'crm',
      enabled: false,
    });
    expect(state.isEnabled(registry.extensions[0]!)).toBe(false);

    const disableAuth = mockReqRes('/api/extensions/auth/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    });
    mw(disableAuth.req, disableAuth.res, () => {});
    await disableAuth.settle();
    expect(disableAuth.status).toBe(403);
    expect(JSON.parse(disableAuth.body).error).toContain('driven');

    const unknown = mockReqRes('/api/extensions/nope/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    });
    mw(unknown.req, unknown.res, () => {});
    await unknown.settle();
    expect(unknown.status).toBe(404);

    let passed = false;
    const other = mockReqRes('/other');
    mw(other.req, other.res, () => {
      passed = true;
    });
    await other.settle();
    expect(passed).toBe(true);
  });

  test('rejects disable when driven: true even if toggleable', async () => {
    const registry = modelOf(
      ext({
        id: 'weird',
        kind: 'customer',
        toggleable: true,
        driven: true,
      }),
    );
    const state = createExtensionEnableState();
    const mw = createExtensionEnableMiddleware(() => registry, state);

    const disable = mockReqRes('/api/extensions/weird/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    });
    mw(disable.req, disable.res, () => {});
    await disable.settle();
    expect(disable.status).toBe(403);
    expect(JSON.parse(disable.body)).toEqual({
      error: 'Cannot disable driven extension: weird',
    });
    expect(state.isEnabled(registry.extensions[0]!)).toBe(true);
  });
});
