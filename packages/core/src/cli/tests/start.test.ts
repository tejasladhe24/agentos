import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createStartFetchHandler,
  productionGatewayUrl,
  resolveStartPort,
  runStart,
} from '../lib/start';

describe('start helpers', () => {
  test('resolveStartPort uses option, then PORT, then 8080', () => {
    expect(resolveStartPort(9090)).toBe(9090);
    const prev = Bun.env.PORT;
    Bun.env.PORT = '7777';
    expect(resolveStartPort()).toBe(7777);
    delete Bun.env.PORT;
    expect(resolveStartPort()).toBe(8080);
    if (prev !== undefined) Bun.env.PORT = prev;
  });

  test('productionGatewayUrl', () => {
    expect(productionGatewayUrl(8080)).toBe('http://127.0.0.1:8080');
  });
});

describe('createStartFetchHandler', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('healthz, gateway, static iframe HTML, SPA, reserved 404', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'agentos-start-dist-'));
    temps.push(dist);
    writeFileSync(join(dist, 'index.html'), '<html>shell</html>');
    mkdirSync(join(dist, '__agentos/ext/crm'), { recursive: true });
    writeFileSync(
      join(dist, '__agentos/ext/crm/page.html'),
      '<html><script src="/assets/crm.js"></script></html>',
    );
    writeFileSync(join(dist, 'assets.js'), '/* asset */');

    const fetchHandler = createStartFetchHandler({
      distRoot: dist,
      gateway: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === '/api/ext/crm/health') {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return null;
      },
    });

    const health = await fetchHandler(new Request('http://localhost/healthz'));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const api = await fetchHandler(
      new Request('http://localhost/api/ext/crm/health'),
    );
    expect(api.status).toBe(200);

    const iframe = await fetchHandler(
      new Request('http://localhost/__agentos/ext/crm/page.html'),
    );
    expect(iframe.status).toBe(200);
    expect(await iframe.text()).toContain('/assets/crm.js');

    const spa = await fetchHandler(new Request('http://localhost/login'));
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('shell');

    const reservedMiss = await fetchHandler(
      new Request('http://localhost/api/missing'),
    );
    expect(reservedMiss.status).toBe(404);
  });
});

describe('runStart', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('requires dist/ and serves healthz without children', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentos-start-app-'));
    temps.push(root);
    mkdirSync(join(root, 'extensions'));
    writeFileSync(join(root, 'vite.config.ts'), 'export default {}\n');

    await expect(
      runStart({
        cwd: root,
        spawnChildren: false,
        waitForShutdown: false,
        port: 0,
      }),
    ).rejects.toThrow(/missing dist/);

    const dist = join(root, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), '<html>ok</html>');
    mkdirSync(join(dist, '_public'));

    const handle = await runStart({
      cwd: root,
      spawnChildren: false,
      waitForShutdown: false,
      port: 0,
      prefixLogs: false,
    });
    expect(handle).toBeDefined();
    const port = handle!.port;

    // Use Bun.fetch — other suites mock globalThis.fetch and can leak 404 stubs.
    const res = await Bun.fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const spa = await Bun.fetch(`http://127.0.0.1:${port}/`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('ok');

    handle!.stop();
  });
});
