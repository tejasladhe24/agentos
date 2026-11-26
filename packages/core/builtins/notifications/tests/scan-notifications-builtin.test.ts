import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const builtinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scan builtin notifications', () => {
  test('discovers notifications as driven builtin on port 6117', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const notifications = model.extensions.find(
      (e) => e.id === 'notifications',
    );
    expect(notifications).toBeDefined();
    expect(notifications?.kind).toBe('builtin');
    expect(notifications?.driven).toBe(true);
    expect(notifications?.toggleable).toBe(false);
    expect(notifications?.meta.api).toEqual({
      language: 'bun',
      port: 6117,
    });
  });

  test('discovers the right-sheet inbox UI and its rightSheet meta', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const notifications = model.extensions.find(
      (e) => e.id === 'notifications',
    );
    expect(notifications?.ui['right-sheet']).toMatch(
      /ui[\\/]right-sheet\.tsx$/,
    );
    expect(notifications?.uiEntries['right-sheet']).toBe(
      '/__agentos/ext/notifications/right-sheet.html',
    );
    expect(notifications?.meta.rightSheet).toEqual({
      label: 'Notifications',
      description: 'Recent in-app notifications and alerts',
    });
  });
});
