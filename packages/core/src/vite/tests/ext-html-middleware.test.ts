import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

import {
  agentos,
  resolvedVirtualExtEntryId,
  VIRTUAL_EXT_ENTRY_PREFIX,
} from '@agentos/core/vite/lib/agentos-plugin';

const fixturesRoot = fileURLToPath(new URL('./fixtures', import.meta.url));
const extensionsDir = join(fixturesRoot, 'extensions');
const builtinsDir = join(fixturesRoot, 'builtins');

type PluginHooks = Plugin & {
  configResolved?: (config: { root: string }) => void | Promise<void>;
  resolveId?: (id: string) => string | undefined | null;
  load?: (
    id: string,
  ) => string | undefined | null | Promise<string | undefined | null>;
  configureServer?: (server: ViteDevServer) => void | Promise<void>;
};

function asHooks(plugin: Plugin): PluginHooks {
  return plugin as PluginHooks;
}

function mockReqRes(url: string, method = 'GET') {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const req = { method, url } as IncomingMessage;
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
      return headers;
    },
  };
}

describe('agentos() iframe HTML entries', () => {
  test('resolves and loads virtual ext entry for customer + builtin', async () => {
    const plugin = asHooks(agentos({ extensionsDir, builtinsDir }));
    await plugin.configResolved?.({ root: fixturesRoot });

    const crmId = `${VIRTUAL_EXT_ENTRY_PREFIX}/crm/page`;
    expect(plugin.resolveId?.(crmId)).toBe(
      resolvedVirtualExtEntryId('crm', 'page'),
    );
    const crmSource = await plugin.load?.(
      resolvedVirtualExtEntryId('crm', 'page'),
    );
    expect(crmSource).toContain('mountExtensionView');
    expect(crmSource).toContain(join(extensionsDir, 'crm/ui/page.tsx'));

    const authId = `${VIRTUAL_EXT_ENTRY_PREFIX}/auth/page`;
    expect(plugin.resolveId?.(authId)).toBe(
      resolvedVirtualExtEntryId('auth', 'page'),
    );
    const authSource = await plugin.load?.(
      resolvedVirtualExtEntryId('auth', 'page'),
    );
    expect(authSource).toContain(join(builtinsDir, 'auth/ui/page.tsx'));
  });

  test('middleware serves HTML for known views and 404s unknown', async () => {
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
    expect(middlewares.length).toBeGreaterThanOrEqual(1);
    const mw = middlewares[middlewares.length - 1]!;

    const ok = mockReqRes('/__agentos/ext/crm/page.html?theme=dark');
    let nextCalled = false;
    mw(ok.req, ok.res, () => {
      nextCalled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(nextCalled).toBe(false);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('text/html');
    expect(ok.body).toContain('/@id/virtual:agentos-ext-entry/crm/page');
    expect(ok.body).toContain('id="root"');

    const builtin = mockReqRes('/__agentos/ext/auth/page.html');
    mw(builtin.req, builtin.res, () => {
      nextCalled = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(builtin.status).toBe(200);
    expect(builtin.body).toContain('/@id/virtual:agentos-ext-entry/auth/page');

    const missing = mockReqRes('/__agentos/ext/nope/page.html');
    mw(missing.req, missing.res, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(missing.status).toBe(404);

    const passthrough = mockReqRes('/other.html');
    let passed = false;
    mw(passthrough.req, passthrough.res, () => {
      passed = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(passed).toBe(true);
  });
});
