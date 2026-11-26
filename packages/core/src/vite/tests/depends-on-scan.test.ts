import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

let root: string;
let extensionsDir: string;
let builtinsDir: string;

function writeExtension(id: string, meta: unknown): void {
  const dir = join(extensionsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agentos-depends-on-'));
  extensionsDir = join(root, 'extensions');
  builtinsDir = join(root, 'builtins');
  mkdirSync(builtinsDir, { recursive: true });
  writeExtension('mailer', {
    dependsOn: ['notifications', ' auth ', 'notifications', 'mailer', '', 7],
  });
  writeExtension('plain', { name: 'Plain' });
  writeExtension('bad', { dependsOn: 'notifications' });
  writeExtension('empty', { dependsOn: [] });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const metaOf = (id: string) =>
  scanExtensions({ extensionsDir, builtinsDir }).extensions.find(
    (e) => e.id === id,
  )?.meta;

describe('meta.json dependsOn', () => {
  test('keeps unique, trimmed ids and drops self / junk', () => {
    expect(metaOf('mailer')?.dependsOn).toEqual(['notifications', 'auth']);
  });

  test('omitted, non-array, and empty declarations yield no dependsOn', () => {
    expect(metaOf('plain')?.dependsOn).toBeUndefined();
    expect(metaOf('bad')?.dependsOn).toBeUndefined();
    expect(metaOf('empty')?.dependsOn).toBeUndefined();
  });
});
