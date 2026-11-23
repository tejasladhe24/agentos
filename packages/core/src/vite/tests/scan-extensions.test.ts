import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const fixturesRoot = fileURLToPath(new URL('./fixtures', import.meta.url));
const extensionsDir = join(fixturesRoot, 'extensions');
const builtinsDir = join(fixturesRoot, 'builtins');

describe('scanExtensions', () => {
  test('discovers builtins and customer extensions', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const ids = model.extensions.map((e) => e.id);

    expect(ids).toContain('auth');
    expect(ids).toContain('crm');
    expect(ids).toContain('invoices');
    expect(ids).toContain('bare');
    expect(ids).toContain('broken');
    expect(model.scannedAt).toBeGreaterThan(0);
  });

  test('marks kinds and sorts builtins before customers', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const auth = model.extensions.find((e) => e.id === 'auth');
    const crm = model.extensions.find((e) => e.id === 'crm');

    expect(auth?.kind).toBe('builtin');
    expect(crm?.kind).toBe('customer');
    expect(model.extensions[0]?.kind).toBe('builtin');
  });

  test('reads bun meta.json and api/routes', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const crm = model.extensions.find((e) => e.id === 'crm');

    expect(crm?.name).toBe('CRM Helper');
    expect(crm?.meta.icon).toBe('Users');
    expect(crm?.meta.api).toEqual({
      language: 'bun',
      port: 6101,
      routesDir: 'api/routes',
    });
    expect(crm?.meta.public).toEqual({
      ui: [{ path: '/p/crm', view: 'page' }],
      apiPrefixes: ['/portal/'],
    });
    expect(crm?.apiRoutesDir).toBe(join(extensionsDir, 'crm/api/routes'));
    expect(crm?.metaPath).toBe(join(extensionsDir, 'crm/meta.json'));
  });

  test('discovers ui and agent files', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const crm = model.extensions.find((e) => e.id === 'crm');

    expect(crm?.ui.page).toBe(join(extensionsDir, 'crm/ui/page.tsx'));
    expect(crm?.ui.sidebar).toBe(join(extensionsDir, 'crm/ui/sidebar.tsx'));
    expect(crm?.ui.widget).toBeUndefined();
    expect(crm?.agent.tools).toBe(join(extensionsDir, 'crm/agent/tools.json'));
    expect(crm?.agent.skills).toBe(join(extensionsDir, 'crm/agent/skills.ts'));
    expect(crm?.agent.instructions).toBe(
      join(extensionsDir, 'crm/agent/instructions.md'),
    );
  });

  test('reads activityBarSection from meta.json', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const auth = model.extensions.find((e) => e.id === 'auth');
    const crm = model.extensions.find((e) => e.id === 'crm');

    expect(auth?.meta.activityBarSection).toBe('secondary');
    expect(crm?.meta.activityBarSection).toBeUndefined();
  });

  test('enriches driven, toggleable, uiEntries, and tool descriptors', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const auth = model.extensions.find((e) => e.id === 'auth');
    const crm = model.extensions.find((e) => e.id === 'crm');

    expect(auth?.driven).toBe(true);
    expect(auth?.toggleable).toBe(false);
    expect(auth?.uiEntries.page).toBe('/__agentos/ext/auth/page.html');

    expect(crm?.driven).toBe(false);
    expect(crm?.toggleable).toBe(true);
    expect(crm?.uiEntries).toEqual({
      page: '/__agentos/ext/crm/page.html',
      sidebar: '/__agentos/ext/crm/sidebar.html',
    });
    expect(crm?.agentDescriptors.tools).toEqual([]);
    expect(crm?.agentDescriptors.skills).toEqual([]);
  });

  test('resolves python service links', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const invoices = model.extensions.find((e) => e.id === 'invoices');

    expect(invoices?.meta.api?.language).toBe('python');
    expect(invoices?.service).toEqual({
      root: '../../services/invoice-bot',
      resolvedRoot: join(fixturesRoot, 'services/invoice-bot'),
      port: 6102,
      health: '/health',
    });
  });

  test('parses worker kind concurrency and timeout', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentos-scan-worker-'));
    const extDir = join(root, 'extensions');
    const builtinsEmpty = join(root, 'builtins');
    const serviceRoot = join(root, 'services', 'crawler');
    const mapMonitor = join(extDir, 'map-monitor');
    try {
      mkdirSync(mapMonitor, { recursive: true });
      mkdirSync(builtinsEmpty, { recursive: true });
      mkdirSync(serviceRoot, { recursive: true });
      writeFileSync(
        join(mapMonitor, 'meta.json'),
        JSON.stringify({
          name: 'MAP Monitor',
          api: {
            language: 'python',
            kind: 'worker',
            root: '../../services/crawler',
            port: 6601,
            health: '/health',
            concurrency: 1,
            timeoutSeconds: 300,
          },
        }),
      );
      const model = scanExtensions({
        extensionsDir: extDir,
        builtinsDir: builtinsEmpty,
      });
      const ext = model.extensions.find((e) => e.id === 'map-monitor');
      expect(ext?.meta.api?.kind).toBe('worker');
      expect(ext?.service).toMatchObject({
        kind: 'worker',
        concurrency: 1,
        timeoutSeconds: 300,
        port: 6601,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('falls back to id when meta is missing', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const bare = model.extensions.find((e) => e.id === 'bare');

    expect(bare?.name).toBe('bare');
    expect(bare?.metaPath).toBeUndefined();
    expect(bare?.ui.widget).toBe(join(extensionsDir, 'bare/ui/widget.tsx'));
  });

  test('tolerates invalid meta.json', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const broken = model.extensions.find((e) => e.id === 'broken');

    expect(broken?.name).toBe('broken');
    expect(broken?.meta).toEqual({});
    expect(broken?.metaPath).toBe(join(extensionsDir, 'broken/meta.json'));
  });

  test('returns empty list for empty trees', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'agentos-scan-'));
    const emptyExt = join(emptyRoot, 'extensions');
    const emptyBuiltins = join(emptyRoot, 'builtins');
    mkdirSync(emptyExt);
    mkdirSync(emptyBuiltins);

    try {
      const model = scanExtensions({
        extensionsDir: emptyExt,
        builtinsDir: emptyBuiltins,
      });
      expect(model.extensions).toEqual([]);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  test('keeps builtin when customer id conflicts', () => {
    const conflictRoot = mkdtempSync(join(tmpdir(), 'agentos-conflict-'));
    const extDir = join(conflictRoot, 'extensions');
    const builtinDir = join(conflictRoot, 'builtins');
    mkdirSync(join(extDir, 'auth'), { recursive: true });
    mkdirSync(join(builtinDir, 'auth'), { recursive: true });

    try {
      const model = scanExtensions({
        extensionsDir: extDir,
        builtinsDir: builtinDir,
      });
      expect(model.extensions).toHaveLength(1);
      expect(model.extensions[0]?.kind).toBe('builtin');
      expect(model.extensions[0]?.rootDir).toBe(join(builtinDir, 'auth'));
    } finally {
      rmSync(conflictRoot, { recursive: true, force: true });
    }
  });
});
