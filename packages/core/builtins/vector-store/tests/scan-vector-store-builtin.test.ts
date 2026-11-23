import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const builtinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scan builtin vector-store', () => {
  test('discovers vector-store as driven builtin on port 6120', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const vs = model.extensions.find((e) => e.id === 'vector-store');
    expect(vs).toBeDefined();
    expect(vs?.kind).toBe('builtin');
    expect(vs?.driven).toBe(true);
    expect(vs?.toggleable).toBe(false);
    expect(vs?.meta.api).toEqual({
      language: 'bun',
      port: 6120,
    });
  });
});
