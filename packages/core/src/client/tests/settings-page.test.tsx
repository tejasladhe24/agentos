import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsPage } from '@agentos/core/client/components/settings-page';

describe('SettingsPage', () => {
  test('renders the shared settings frame and passes data attributes through', () => {
    const html = renderToStaticMarkup(
      <SettingsPage data-slot="demo" data-section="x">
        content
      </SettingsPage>,
    );
    expect(html).toContain(
      'fixed inset-0 overflow-y-auto bg-background px-6 py-6 text-foreground',
    );
    expect(html).toContain('data-slot="demo"');
    expect(html).toContain('data-section="x"');
    expect(html).toContain('content');
  });

  test('extra classes merge without dropping the frame', () => {
    const html = renderToStaticMarkup(
      <SettingsPage className="px-2">x</SettingsPage>,
    );
    expect(html).toContain('fixed inset-0');
    expect(html).toContain('px-2');
    expect(html).not.toContain('px-6');
  });
});
