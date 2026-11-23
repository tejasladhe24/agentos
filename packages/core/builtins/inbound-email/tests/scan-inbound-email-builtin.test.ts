import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const builtinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scan builtin inbound-email', () => {
  test('discovers inbound-email as driven builtin on port 6121', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const ext = model.extensions.find((e) => e.id === 'inbound-email');
    expect(ext).toBeDefined();
    expect(ext?.kind).toBe('builtin');
    expect(ext?.driven).toBe(true);
    expect(ext?.toggleable).toBe(false);
    expect(ext?.meta.api).toEqual({
      language: 'bun',
      port: 6121,
    });
    expect(ext?.meta.public?.openApiPrefixes).toEqual(['/webhooks/']);
  });
});
