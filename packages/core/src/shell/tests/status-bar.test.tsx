import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBar } from '@agentos/core/shell/components';
import { defaultEnabledById } from '@agentos/core/shell/lib';
import { STUB_EXTENSION_CATALOG } from './fixtures/stub-extension-catalog';

describe('StatusBar', () => {
  test('renders status text when provided', () => {
    const html = renderToStaticMarkup(
      <StatusBar statusText="done" statusTone="success" />,
    );
    expect(html).toContain('data-slot="status-text"');
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('done');
  });

  test('warning and error tones get distinct status text styling', () => {
    const warning = renderToStaticMarkup(
      <StatusBar statusText="slow" statusTone="warning" />,
    );
    expect(warning).toContain('data-tone="warning"');
    expect(warning).toContain('text-amber-500');

    const error = renderToStaticMarkup(
      <StatusBar statusText="failed" statusTone="error" />,
    );
    expect(error).toContain('data-tone="error"');
    expect(error).toContain('text-destructive');
  });

  test('shows enabled customer badge', () => {
    const html = renderToStaticMarkup(
      <StatusBar
        extensions={STUB_EXTENSION_CATALOG}
        enabledById={defaultEnabledById(STUB_EXTENSION_CATALOG)}
      />,
    );
    expect(html).toContain('data-slot="status-enabled"');
    expect(html).toContain('enabled: 2/2');
  });

  test('shows crashed badge and reserved loading spinner slot', () => {
    const html = renderToStaticMarkup(
      <StatusBar
        contributions={[
          { extensionId: 'crm', view: 'page', src: '/crm.html' },
          { extensionId: 'invoices', view: 'page', src: '/inv.html' },
        ]}
        runtimeStatus={{
          'crm:page': 'crashed',
          'invoices:page': 'loading',
        }}
      />,
    );
    expect(html).toContain('data-slot="status-crashed"');
    expect(html).toContain('crashed: 1');
    expect(html).toContain('data-slot="status-loading-slot"');
    expect(html).toContain('data-loading="true"');
    expect(html).toContain('data-slot="status-loading"');
    expect(html).toContain('data-slot="status-chat-toggle"');
    expect(html).toContain('data-slot="status-bar-end"');
    // Theme toggle mounts client-only (EnsureMounted); chat precedes loading slot.
    expect(html.indexOf('status-chat-toggle')).toBeLessThan(
      html.indexOf('status-loading-slot'),
    );
  });

  test('reserves loading slot space when idle', () => {
    const html = renderToStaticMarkup(<StatusBar />);
    expect(html).toContain('data-slot="status-loading-slot"');
    expect(html).toContain('data-loading="false"');
    expect(html).not.toContain('data-slot="status-loading"');
  });

  test('ignores crashed status for unmounted contributions', () => {
    const html = renderToStaticMarkup(
      <StatusBar
        contributions={[
          { extensionId: 'invoices', view: 'page', src: '/inv.html' },
        ]}
        runtimeStatus={{
          'crm:page': 'crashed',
          'invoices:page': 'active',
        }}
      />,
    );
    expect(html).not.toContain('data-slot="status-crashed"');
    expect(html).not.toContain('crashed:');
  });
});
