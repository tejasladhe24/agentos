import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

import {
  agentos,
  createExtApiProxyMiddleware,
  createExtensionEnableState,
  parseExtApiPath,
} from '@agentos/core/vite/lib/agentos-plugin';
import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';
import type { ProxyFetch } from '@agentos/core/vite/lib/ext-api-proxy';
import type {
  RegistryModel,
  ScannedExtension,
} from '@agentos/core/vite/lib/types';

const fixturesRoot = fileURLToPath(new URL('./fixtures', import.meta.url));
const extensionsDir = join(fixturesRoot, 'extensions');
const builtinsDir = join(fixturesRoot, 'builtins');

type PluginHooks = Plugin & {
  configResolved?: (config: { root: string }) => void | Promise<void>;
  configureServer?: (server: ViteDevServer) => void | Promise<void>;
};

function asHooks(plugin: Plugin): PluginHooks {
  return plugin as PluginHooks;
}

function mockReqRes(
  url: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string | string[] | undefined>;
  } = {},
) {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  const resHeaders: Record<string, string> = {};
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  const req = {
    method: options.method ?? 'GET',
    url,
    headers: options.headers ?? {},
    on(event: string, cb: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(cb);
      if (event === 'end') {
        queueMicrotask(() => {
          if (options.body !== undefined) {
            for (const fn of listeners.data ?? []) {
              fn(Buffer.from(options.body!));
            }
          }
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
      resHeaders[name.toLowerCase()] = value;
    },
    write(chunk: string | Buffer) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      return true;
    },
    on() {},
    once() {},
    off() {},
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
      return resHeaders;
    },
    async settle() {
      await new Promise((r) => queueMicrotask(r));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('parseExtApiPath', () => {
  test('strips prefix and keeps query', () => {
    expect(parseExtApiPath('/api/ext/crm/tools/search?q=1')).toEqual({
      extensionId: 'crm',
      targetPath: '/tools/search',
      search: '?q=1',
    });
    expect(parseExtApiPath('/api/ext/crm')).toEqual({
      extensionId: 'crm',
      targetPath: '/',
      search: '',
    });
    expect(parseExtApiPath('/api/ext/crm/')).toEqual({
      extensionId: 'crm',
      targetPath: '/',
      search: '',
    });
    expect(parseExtApiPath('/__agentos/ext/crm/page.html')).toBeNull();
  });
});

describe('createExtApiProxyMiddleware', () => {
  test('forwards to meta port with cookie/authorization and blocks disabled customer', async () => {
    const registry = scanExtensions({ extensionsDir, builtinsDir });
    const state = createExtensionEnableState();
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const fetchImpl: ProxyFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const mw = createExtApiProxyMiddleware(() => registry, state, fetchImpl);

    const ok = mockReqRes('/api/ext/crm/tools/search_contacts?limit=2', {
      method: 'POST',
      body: '{"q":"a"}',
      headers: {
        cookie: 'session=abc',
        authorization: 'Bearer tok',
        'content-type': 'application/json',
        host: 'localhost:5173',
      },
    });
    mw(ok.req, ok.res, () => {});
    await ok.settle();

    expect(ok.status).toBe(200);
    expect(ok.body).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'http://127.0.0.1:6101/tools/search_contacts?limit=2',
    );
    const fwd = calls[0]!.init?.headers as Headers;
    expect(fwd.get('cookie')).toBe('session=abc');
    expect(fwd.get('authorization')).toBe('Bearer tok');
    expect(fwd.get('host')).toBeNull();

    state.setEnabled('crm', false);
    const blocked = mockReqRes('/api/ext/crm/tools/x');
    mw(blocked.req, blocked.res, () => {});
    await blocked.settle();
    expect(blocked.status).toBe(403);
    expect(blocked.body).toContain('disabled');

    // Builtin with no port → not 403; 502 missing upstream.
    const auth = mockReqRes('/api/ext/auth/session');
    mw(auth.req, auth.res, () => {});
    await auth.settle();
    expect(auth.status).toBe(502);

    // Builtin always proxies even if map says false.
    const withPort: RegistryModel = {
      extensions: registry.extensions.map((e): ScannedExtension =>
        e.id === 'auth'
          ? {
              ...e,
              meta: {
                ...e.meta,
                api: { language: 'bun', port: 6199 },
              },
            }
          : e,
      ),
      scannedAt: registry.scannedAt,
    };
    state.setEnabled('auth', false);
    const mw2 = createExtApiProxyMiddleware(() => withPort, state, fetchImpl);
    calls.length = 0;
    const builtinOk = mockReqRes('/api/ext/auth/me');
    mw2(builtinOk.req, builtinOk.res, () => {});
    await builtinOk.settle();
    expect(builtinOk.status).toBe(200);
    expect(calls[0]!.url).toBe('http://127.0.0.1:6199/me');

    const unknown = mockReqRes('/api/ext/missing/x');
    mw(unknown.req, unknown.res, () => {});
    await unknown.settle();
    expect(unknown.status).toBe(404);

    let passed = false;
    const other = mockReqRes('/api/other');
    mw(other.req, other.res, () => {
      passed = true;
    });
    await other.settle();
    expect(passed).toBe(true);
  });

  test('python service port from meta is used', async () => {
    const registry = scanExtensions({ extensionsDir, builtinsDir });
    const state = createExtensionEnableState();
    let hit = '';
    const fetchImpl: ProxyFetch = async (url) => {
      hit = url;
      return new Response('ok');
    };
    const mw = createExtApiProxyMiddleware(() => registry, state, fetchImpl);
    const req = mockReqRes('/api/ext/invoices/health');
    mw(req.req, req.res, () => {});
    await req.settle();
    expect(req.status).toBe(200);
    expect(hit).toBe('http://127.0.0.1:6102/health');
  });
});

describe('agentos() gateway middleware wiring', () => {
  test('registers a single Connect bridge over createGateway on configureServer', async () => {
    const plugin = asHooks(agentos({ extensionsDir, builtinsDir }));
    await plugin.configResolved?.({ root: fixturesRoot });

    const middlewares: Array<
      (req: IncomingMessage, res: ServerResponse, next: () => void) => void
    > = [];

    const fakeServer = {
      moduleGraph: {
        getModuleById() {
          return undefined;
        },
        invalidateModule() {},
      },
      watcher: {
        add() {},
        on() {},
      },
      ws: { send() {} },
      middlewares: {
        use(
          fn: (
            req: IncomingMessage,
            res: ServerResponse,
            next: () => void,
          ) => void,
        ) {
          middlewares.push(fn);
        },
      },
    } as unknown as ViteDevServer;

    await plugin.configureServer?.(fakeServer);
    expect(middlewares.length).toBe(1);
    const gw = middlewares[0]!;

    // Unrelated path passes through.
    const other = mockReqRes('/spa/route');
    let passed = false;
    gw(other.req, other.res, () => {
      passed = true;
    });
    await other.settle();
    expect(passed).toBe(true);

    const enableHit = mockReqRes('/api/extensions/crm/enable', {
      method: 'POST',
      body: JSON.stringify({ enabled: false }),
    });
    gw(enableHit.req, enableHit.res, () => {});
    await enableHit.settle();
    expect(enableHit.status).toBe(200);

    const registryHit = mockReqRes('/api/agent/registry');
    gw(registryHit.req, registryHit.res, () => {});
    await registryHit.settle();
    expect(registryHit.status).toBe(200);

    // Customer disabled above → proxy 403.
    const proxyHit = mockReqRes('/api/ext/crm/tools/x');
    gw(proxyHit.req, proxyHit.res, () => {});
    await proxyHit.settle();
    expect(proxyHit.status).toBe(403);

    const htmlHit = mockReqRes('/__agentos/ext/crm/page.html');
    gw(htmlHit.req, htmlHit.res, () => {});
    await htmlHit.settle();
    expect(htmlHit.status).toBe(200);
  });
});
