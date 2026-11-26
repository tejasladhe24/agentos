import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeExtEntryModule } from '@agentos/core/vite/lib/ext-entry-module';
import {
  parseExtHtmlPath,
  parseVirtualExtEntryId,
  renderExtHtmlEntry,
  resolvedVirtualExtEntryId,
  virtualExtEntryId,
  virtualExtEntryScriptSrc,
} from '@agentos/core/vite/lib/html-entry';

const fixturesRoot = fileURLToPath(new URL('./fixtures', import.meta.url));

describe('html-entry helpers', () => {
  test('parseExtHtmlPath accepts convention paths', () => {
    expect(parseExtHtmlPath('/__agentos/ext/crm/page.html')).toEqual({
      extensionId: 'crm',
      view: 'page',
    });
    expect(
      parseExtHtmlPath('/__agentos/ext/auth/sidebar.html?theme=dark'),
    ).toEqual({
      extensionId: 'auth',
      view: 'sidebar',
    });
    expect(parseExtHtmlPath('/__agentos/ext/bare/widget.html')).toEqual({
      extensionId: 'bare',
      view: 'widget',
    });
    expect(parseExtHtmlPath('/__agentos/ext/files/right-sidebar.html')).toEqual(
      {
        extensionId: 'files',
        view: 'right-sidebar',
      },
    );
    expect(parseExtHtmlPath('/__agentos/ext/notes/right-sheet.html')).toEqual({
      extensionId: 'notes',
      view: 'right-sheet',
    });
  });

  test('parseExtHtmlPath rejects non-entries', () => {
    expect(parseExtHtmlPath('/api/ext/crm/page')).toBeNull();
    expect(parseExtHtmlPath('/__agentos/ext/crm/page')).toBeNull();
    expect(parseExtHtmlPath('/__agentos/ext/crm/other.html')).toBeNull();
  });

  test('virtual entry ids round-trip', () => {
    expect(virtualExtEntryId('crm', 'page')).toBe(
      'virtual:agentos-ext-entry/crm/page',
    );
    expect(resolvedVirtualExtEntryId('auth', 'page')).toBe(
      '\0virtual:agentos-ext-entry/auth/page',
    );
    expect(
      parseVirtualExtEntryId('virtual:agentos-ext-entry/crm/sidebar'),
    ).toEqual({ extensionId: 'crm', view: 'sidebar' });
    expect(
      parseVirtualExtEntryId('\0virtual:agentos-ext-entry/auth/page'),
    ).toEqual({ extensionId: 'auth', view: 'page' });
    expect(
      parseVirtualExtEntryId('virtual:agentos-ext-entry/files/right-sidebar'),
    ).toEqual({ extensionId: 'files', view: 'right-sidebar' });
    expect(
      parseVirtualExtEntryId('virtual:agentos-ext-entry/notes/right-sheet'),
    ).toEqual({ extensionId: 'notes', view: 'right-sheet' });
  });

  test('renderExtHtmlEntry boots virtual script and FOUC theme', () => {
    const html = renderExtHtmlEntry({
      extensionId: 'crm',
      view: 'page',
      scriptSrc: virtualExtEntryScriptSrc('crm', 'page'),
    });
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('data-agentos-ext');
    expect(html).toContain('src="/@id/virtual:agentos-ext-entry/crm/page"');
    expect(html).toContain('agentos-theme');
    expect(html).toContain('theme');
    expect(html).not.toContain('rel="stylesheet"');
  });

  test('renderExtHtmlEntry emits stylesheet links for production CSS', () => {
    const html = renderExtHtmlEntry({
      extensionId: 'demo',
      view: 'widget',
      scriptSrc: '/assets/__agentos/ext/demo/widget-abc.js',
      stylesheets: ['/assets/globals-xyz.css', '/assets/widget-abc.css'],
    });
    expect(html).toContain(
      '<link rel="stylesheet" crossorigin href="/assets/globals-xyz.css" />',
    );
    expect(html).toContain(
      '<link rel="stylesheet" crossorigin href="/assets/widget-abc.css" />',
    );
  });

  test('serializeExtEntryModule imports fixture view path', () => {
    const pagePath = join(fixturesRoot, 'extensions/crm/ui/page.tsx');
    const source = serializeExtEntryModule(pagePath);
    expect(source).toContain(
      "import { mountExtensionView } from '@agentos/core/client'",
    );
    expect(source).toContain(`import View from ${JSON.stringify(pagePath)}`);
    expect(source).toContain('mountExtensionView(View)');
  });
});
