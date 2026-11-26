import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

import {
  agentos,
  createPublicAssetsMiddleware,
  parsePublicAssetPath,
  resolvePublicAssetFile,
} from '@agentos/core/vite/lib/agentos-plugin';

type PluginHooks = Plugin & {
  configResolved?: (config: { root: string }) => void | Promise<void>;
  config?: () => { publicDir?: false } | undefined;
  configureServer?: (server: ViteDevServer) => void | Promise<void>;
  writeBundle?: (outputOptions: { dir?: string }) => void;
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

describe('parsePublicAssetPath', () => {
  test('parses /_public relative paths', () => {
    expect(parsePublicAssetPath('/_public/logo.svg')).toBe('logo.svg');
    expect(parsePublicAssetPath('/_public/fonts/sans.woff2?v=1')).toBe(
      'fonts/sans.woff2',
    );
  });

  test('rejects non-public paths and bare prefix', () => {
    expect(parsePublicAssetPath('/logo.svg')).toBeNull();
    expect(parsePublicAssetPath('/_public')).toBeNull();
    expect(parsePublicAssetPath('/_public/')).toBeNull();
  });
});

describe('resolvePublicAssetFile', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolves files under public root and rejects traversal', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentos-public-'));
    temps.push(root);
    writeFileSync(join(root, 'logo.svg'), '<svg />');

    expect(resolvePublicAssetFile(root, 'logo.svg')).toBe(
      join(root, 'logo.svg'),
    );
    expect(resolvePublicAssetFile(root, '../secret.txt')).toBeNull();
    expect(resolvePublicAssetFile(root, 'missing.svg')).toBeNull();
  });
});

describe('createPublicAssetsMiddleware', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('serves assets with content-type and 404s missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentos-public-mw-'));
    temps.push(root);
    writeFileSync(join(root, 'logo.svg'), '<svg id="mark" />');

    const mw = createPublicAssetsMiddleware(() => root);
    const settle = () => new Promise((r) => setTimeout(r, 0));

    const hit = mockReqRes('/_public/logo.svg');
    mw(hit.req, hit.res, () => {
      throw new Error('should not next');
    });
    await settle();
    expect(hit.status).toBe(200);
    expect(hit.headers['content-type']).toBe('image/svg+xml');
    expect(hit.body).toContain('id="mark"');

    const missing = mockReqRes('/_public/nope.png');
    mw(missing.req, missing.res, () => {
      throw new Error('should not next');
    });
    await settle();
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(missing.body).toContain('Not Found');
    expect(missing.body).toContain('/_public/nope.png');

    let nexted = false;
    const pass = mockReqRes('/api/health');
    mw(pass.req, pass.res, () => {
      nexted = true;
    });
    await settle();
    expect(nexted).toBe(true);
  });
});

describe('agentos() public assets wiring', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('disables Vite publicDir and serves /_public via configureServer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentos-public-plugin-'));
    temps.push(root);
    mkdirSync(join(root, 'extensions'), { recursive: true });
    mkdirSync(join(root, 'builtins'), { recursive: true });
    mkdirSync(join(root, 'public'), { recursive: true });
    writeFileSync(join(root, 'public', 'logo.svg'), '<svg />');

    const plugin = asHooks(
      agentos({
        extensionsDir: join(root, 'extensions'),
        builtinsDir: join(root, 'builtins'),
      }),
    );
    expect(plugin.config?.()).toEqual({ publicDir: false });
    await plugin.configResolved?.({ root });

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

    const hit = mockReqRes('/_public/logo.svg');
    middlewares[0]!(hit.req, hit.res, () => {
      throw new Error('should not next');
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(hit.status).toBe(200);
    expect(hit.body).toContain('<svg');
  });

  test('writeBundle copies public/ to dist/_public/', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentos-public-build-'));
    temps.push(root);
    mkdirSync(join(root, 'extensions'), { recursive: true });
    mkdirSync(join(root, 'builtins'), { recursive: true });
    mkdirSync(join(root, 'public'), { recursive: true });
    writeFileSync(join(root, 'public', 'favicon.svg'), '<svg id="fav" />');
    const outDir = join(root, 'dist');
    mkdirSync(outDir, { recursive: true });

    const plugin = asHooks(
      agentos({
        extensionsDir: join(root, 'extensions'),
        builtinsDir: join(root, 'builtins'),
      }),
    );
    await plugin.configResolved?.({ root });
    plugin.writeBundle?.({ dir: outDir });

    const copied = Bun.file(join(outDir, '_public', 'favicon.svg'));
    expect(await copied.exists()).toBe(true);
    expect(await copied.text()).toContain('id="fav"');
  });
});
