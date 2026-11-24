import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const builtinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scan builtin auth', () => {
  test('discovers auth as driven builtin on port 6110', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const auth = model.extensions.find((e) => e.id === 'auth');
    expect(auth).toBeDefined();
    expect(auth?.kind).toBe('builtin');
    expect(auth?.driven).toBe(true);
    expect(auth?.toggleable).toBe(false);
    expect(auth?.meta.api).toEqual({
      language: 'bun',
      port: 6110,
    });
    expect(auth?.ui.page).toBeUndefined();
    expect(auth?.ui.sidebar).toBeUndefined();
    expect(auth?.ui.settings).toBeTruthy();
    expect(auth?.uiEntries.settings).toBe('/__agentos/ext/auth/settings.html');
    expect(auth?.meta.settings?.map((s) => s.id)).toEqual([
      'profile',
      'organization',
    ]);
  });
});
