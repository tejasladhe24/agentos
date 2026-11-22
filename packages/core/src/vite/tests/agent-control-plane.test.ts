import { describe, expect, test } from 'bun:test';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createAgentControlPlaneMiddleware,
  parseAgentExtensionEnablePath,
} from '@agentos/core/vite/lib/agent-control-plane';
import { createExtensionEnableState } from '@agentos/core/vite/lib/extension-enable-state';
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
  return { extensions, scannedAt: 42 };
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

describe('parseAgentExtensionEnablePath', () => {
  test('parses agent enable path', () => {
    expect(
      parseAgentExtensionEnablePath('/api/agent/extensions/crm/enable'),
    ).toEqual({ extensionId: 'crm' });
    expect(
      parseAgentExtensionEnablePath('/api/agent/extensions/crm/enable/'),
    ).toEqual({ extensionId: 'crm' });
    expect(
      parseAgentExtensionEnablePath('/api/extensions/crm/enable'),
    ).toBeNull();
  });
});

describe('createAgentControlPlaneMiddleware', () => {
  test('GET /api/agent/registry returns enabled contributions only', async () => {
    const registry = modelOf(
      ext({
        id: 'auth',
        kind: 'builtin',
        toggleable: false,
        name: 'Auth',
      }),
      ext({
        id: 'crm',
        kind: 'customer',
        toggleable: true,
        name: 'CRM',
        agentDescriptors: {
          tools: [{ name: 'search' }],
          skills: ['search-contacts'],
        },
      }),
    );
    const state = createExtensionEnableState();
    state.setEnabled('crm', false);
    const mw = createAgentControlPlaneMiddleware(() => registry, state);

    const hit = mockReqRes('/api/agent/registry');
    mw(hit.req, hit.res, () => {});
    await hit.settle();

    expect(hit.status).toBe(200);
    expect(JSON.parse(hit.body)).toEqual({
      scannedAt: 42,
      extensions: [
        {
          id: 'auth',
          name: 'Auth',
          kind: 'builtin',
          driven: true,
          tools: [],
          skills: [],
          instructions: '',
        },
      ],
    });
  });

  test('POST enable rejects driven: true and toggles customer', async () => {
    const registry = modelOf(
      ext({ id: 'crm', kind: 'customer', toggleable: true }),
      ext({
        id: 'ai',
        kind: 'builtin',
        toggleable: false,
        driven: true,
      }),
    );
    const state = createExtensionEnableState();
    const mw = createAgentControlPlaneMiddleware(() => registry, state);

    const disableCrm = mockReqRes('/api/agent/extensions/crm/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    });
    mw(disableCrm.req, disableCrm.res, () => {});
    await disableCrm.settle();
    expect(disableCrm.status).toBe(200);
    expect(JSON.parse(disableCrm.body)).toEqual({
      id: 'crm',
      enabled: false,
    });

    const disableAi = mockReqRes('/api/agent/extensions/ai/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    });
    mw(disableAi.req, disableAi.res, () => {});
    await disableAi.settle();
    expect(disableAi.status).toBe(403);
    expect(JSON.parse(disableAi.body).error).toContain('driven');
  });

  test('chat and hitl proxy to builtin upstreams via rewritten paths', async () => {
    const registry = modelOf(
      ext({
        id: 'ai',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        meta: { api: { language: 'bun', port: 7101 } },
      }),
      ext({
        id: 'hitl',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        meta: { api: { language: 'bun', port: 7102 } },
      }),
    );
    const state = createExtensionEnableState();
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response('ok');
    };
    const mw = createAgentControlPlaneMiddleware(
      () => registry,
      state,
      fetchImpl,
    );

    const chat = mockReqRes('/api/agent/chat', { method: 'POST', body: '{}' });
    mw(chat.req, chat.res, () => {});
    await chat.settle();
    expect(chat.status).toBe(200);
    expect(calls[0]).toBe('http://127.0.0.1:7101/chat');

    const hitl = mockReqRes('/api/agent/hitl', { method: 'POST', body: '{}' });
    mw(hitl.req, hitl.res, () => {});
    await hitl.settle();
    expect(hitl.status).toBe(200);
    expect(calls[1]).toBe('http://127.0.0.1:7102/approvals');
  });

  test('passes through unrelated paths', async () => {
    const mw = createAgentControlPlaneMiddleware(
      () => modelOf(),
      createExtensionEnableState(),
    );
    let passed = false;
    const other = mockReqRes('/api/ext/crm/tools');
    mw(other.req, other.res, () => {
      passed = true;
    });
    await other.settle();
    expect(passed).toBe(true);
  });
});
