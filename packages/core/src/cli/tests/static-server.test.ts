import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isSpaReservedPath,
  resolveDistFile,
  tryServeStatic,
  trySpaFallback,
} from '../lib/static-server';

describe('static-server', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDist(): string {
    const root = mkdtempSync(join(tmpdir(), 'agentos-dist-'));
    temps.push(root);
    return root;
  }

  test('resolveDistFile serves files and blocks traversal', () => {
    const dist = tempDist();
    writeFileSync(join(dist, 'app.js'), 'console.log(1)');
    mkdirSync(join(dist, '__agentos/ext/crm'), { recursive: true });
    writeFileSync(
      join(dist, '__agentos/ext/crm/page.html'),
      '<html>crm</html>',
    );

    expect(resolveDistFile(dist, '/app.js')).toBe(join(dist, 'app.js'));
    expect(resolveDistFile(dist, '/__agentos/ext/crm/page.html')).toBe(
      join(dist, '__agentos/ext/crm/page.html'),
    );
    expect(resolveDistFile(dist, '/../secret')).toBeNull();
    expect(resolveDistFile(dist, '/missing.js')).toBeNull();
  });

  test('isSpaReservedPath covers gateway prefixes', () => {
    expect(isSpaReservedPath('/_public/logo.svg')).toBe(true);
    expect(isSpaReservedPath('/__agentos/ext/crm/page.html')).toBe(true);
    expect(isSpaReservedPath('/api/ext/crm/x')).toBe(true);
    expect(isSpaReservedPath('/login')).toBe(false);
    expect(isSpaReservedPath('/')).toBe(false);
  });

  test('tryServeStatic and trySpaFallback', async () => {
    const dist = tempDist();
    writeFileSync(join(dist, 'index.html'), '<html>spa</html>');
    writeFileSync(join(dist, 'chunk.js'), 'export {}');

    const asset = tryServeStatic(dist, '/chunk.js', 'GET');
    expect(asset).not.toBeNull();
    expect(await (await asset)!.text()).toBe('export {}');

    const spa = trySpaFallback(dist, '/login', 'GET');
    expect(spa).not.toBeNull();
    expect(await (await spa)!.text()).toContain('spa');

    expect(trySpaFallback(dist, '/api/ext/x', 'GET')).toBeNull();
    expect(
      trySpaFallback(dist, '/__agentos/ext/crm/page.html', 'GET'),
    ).toBeNull();
  });
});
