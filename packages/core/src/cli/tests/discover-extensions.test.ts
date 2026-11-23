import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverBunApis,
  discoverPythonServices,
  pythonProcessName,
  WORKER_CONCURRENCY_ENV,
  WORKER_TIMEOUT_SECONDS_ENV,
  workerProcessEnv,
} from '../lib/discover-extensions';

const exampleExtensions = fileURLToPath(
  new URL('../../../../../examples/client-app/extensions', import.meta.url),
);

describe('discoverBunApis', () => {
  test('finds crm-helper in example app', () => {
    const apis = discoverBunApis(exampleExtensions);
    const crm = apis.find((a) => a.id === 'crm-helper');
    expect(crm).toBeDefined();
    expect(crm!.port).toBe(6101);
    expect(crm!.serverEntry).toContain('crm-helper/api/server.ts');
  });

  test('skips bun meta without server.ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-cli-'));
    try {
      const ext = join(dir, 'broken');
      mkdirSync(ext);
      writeFileSync(
        join(ext, 'meta.json'),
        JSON.stringify({ api: { language: 'bun', port: 6100 } }),
      );
      expect(discoverBunApis(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('discoverPythonServices', () => {
  test('finds invoice-bot in example app as http', () => {
    const services = discoverPythonServices(exampleExtensions);
    const invoice = services.find((s) => s.id === 'invoice-bot');
    expect(invoice).toBeDefined();
    expect(invoice!.port).toBe(6102);
    expect(invoice!.resolvedRoot).toContain('invoice-bot');
    expect(invoice!.kind).toBe('http');
  });

  test('returns empty for missing dir', () => {
    expect(discoverPythonServices('/tmp/does-not-exist-agentos')).toEqual([]);
  });

  test('parses worker kind with concurrency and timeout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-cli-'));
    try {
      const ext = join(dir, 'map-monitor');
      const serviceRoot = join(dir, 'services', 'crawler');
      mkdirSync(ext, { recursive: true });
      mkdirSync(serviceRoot, { recursive: true });
      writeFileSync(
        join(ext, 'meta.json'),
        JSON.stringify({
          api: {
            language: 'python',
            root: '../services/crawler',
            port: 6601,
            kind: 'worker',
            concurrency: 1,
            timeoutSeconds: 300,
          },
        }),
      );
      const services = discoverPythonServices(dir);
      expect(services).toHaveLength(1);
      expect(services[0]).toMatchObject({
        id: 'map-monitor',
        kind: 'worker',
        concurrency: 1,
        timeoutSeconds: 300,
        port: 6601,
      });
      expect(workerProcessEnv(services[0]!)).toEqual({
        [WORKER_CONCURRENCY_ENV]: '1',
        [WORKER_TIMEOUT_SECONDS_ENV]: '300',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('workerProcessEnv empty for http', () => {
    expect(
      workerProcessEnv({ kind: 'http', concurrency: 2, timeoutSeconds: 10 }),
    ).toEqual({});
  });

  test('discovers dual Bun + service sibling', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-cli-dual-'));
    try {
      const ext = join(dir, 'questionnaires');
      const serviceRoot = join(dir, 'services', 'questionnaires');
      mkdirSync(join(ext, 'api'), { recursive: true });
      mkdirSync(serviceRoot, { recursive: true });
      writeFileSync(join(ext, 'api', 'server.ts'), 'export {}');
      writeFileSync(
        join(ext, 'meta.json'),
        JSON.stringify({
          api: { language: 'bun', port: 6201 },
          service: {
            root: '../services/questionnaires',
            port: 6211,
            kind: 'http',
          },
        }),
      );

      const bun = discoverBunApis(dir);
      expect(bun).toHaveLength(1);
      expect(bun[0]).toMatchObject({ id: 'questionnaires', port: 6201 });

      const services = discoverPythonServices(dir);
      expect(services).toHaveLength(1);
      expect(services[0]).toMatchObject({
        id: 'questionnaires',
        port: 6211,
        kind: 'http',
        dual: true,
        mount: '/_service',
      });
      expect(pythonProcessName(services[0]!)).toBe('questionnaires:service');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips dual service when ports collide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentos-cli-collide-'));
    try {
      const ext = join(dir, 'dual');
      const serviceRoot = join(dir, 'services', 'dual');
      mkdirSync(join(ext, 'api'), { recursive: true });
      mkdirSync(serviceRoot, { recursive: true });
      writeFileSync(join(ext, 'api', 'server.ts'), 'export {}');
      writeFileSync(
        join(ext, 'meta.json'),
        JSON.stringify({
          api: { language: 'bun', port: 6201 },
          service: { root: '../services/dual', port: 6201 },
        }),
      );
      expect(discoverBunApis(dir)).toHaveLength(1);
      expect(discoverPythonServices(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('pythonProcessName for python-only', () => {
    expect(pythonProcessName({ id: 'invoice-bot' })).toBe('invoice-bot');
  });
});
