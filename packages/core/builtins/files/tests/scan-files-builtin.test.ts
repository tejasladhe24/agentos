import { describe, expect, test } from 'bun:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const builtinsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('scan builtin files', () => {
  test('discovers files as driven builtin with secondary Activity Bar + page', () => {
    const model = scanExtensions({
      extensionsDir: join(builtinsDir, '__no_customer_extensions__'),
      builtinsDir,
    });

    const files = model.extensions.find((e) => e.id === 'files');
    expect(files).toBeDefined();
    expect(files?.kind).toBe('builtin');
    expect(files?.driven).toBe(true);
    expect(files?.toggleable).toBe(false);
    expect(files?.meta.name).toBe('Files');
    expect(files?.meta.icon).toBe('Folder');
    expect(files?.meta.activityBarSection).toBe('secondary');
    expect(files?.meta.api).toEqual({
      language: 'bun',
      port: 6116,
    });
    expect(files?.ui.page).toBeTruthy();
    expect(files?.ui.sidebar).toBeTruthy();
    expect(files?.ui['right-sidebar']).toBeTruthy();
    expect(files?.uiEntries.page).toBe('/__agentos/ext/files/page.html');
    expect(files?.uiEntries['right-sidebar']).toBe(
      '/__agentos/ext/files/right-sidebar.html',
    );
  });
});
