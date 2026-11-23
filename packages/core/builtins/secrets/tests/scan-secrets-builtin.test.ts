import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const builtinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scan builtin secrets', () => {
  test('discovers secrets as driven builtin on port 6118 with secondary UI', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const secrets = model.extensions.find((e) => e.id === 'secrets');
    expect(secrets).toBeDefined();
    expect(secrets?.kind).toBe('builtin');
    expect(secrets?.driven).toBe(true);
    expect(secrets?.toggleable).toBe(false);
    expect(secrets?.meta.api).toEqual({
      language: 'bun',
      port: 6118,
    });
    expect(secrets?.meta.activityBarSection).toBe('secondary');
    expect(secrets?.meta.icon).toBe('Key');
    expect(secrets?.ui.page).toBeTruthy();
    expect(secrets?.uiEntries.page).toBe('/__agentos/ext/secrets/page.html');
  });
});
