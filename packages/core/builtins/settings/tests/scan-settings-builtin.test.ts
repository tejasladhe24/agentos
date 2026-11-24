import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const builtinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scan builtin settings', () => {
  test('discovers settings as driven secondary builtin', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const settings = model.extensions.find((e) => e.id === 'settings');
    expect(settings).toBeDefined();
    expect(settings?.kind).toBe('builtin');
    expect(settings?.driven).toBe(true);
    expect(settings?.toggleable).toBe(false);
    expect(settings?.meta.name).toBe('Settings');
    expect(settings?.meta.icon).toBe('GearSix');
    expect(settings?.meta.activityBarSection).toBe('secondary');
  });
});
