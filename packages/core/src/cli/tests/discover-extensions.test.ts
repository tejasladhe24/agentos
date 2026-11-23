import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverBunApis,
  discoverPythonServices,
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
});
