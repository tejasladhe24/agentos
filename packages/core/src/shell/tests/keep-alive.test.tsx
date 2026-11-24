import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeepAlive } from '@agentos/core/shell/components';

describe('KeepAlive', () => {
  test('renders nothing before first activation', () => {
    const html = renderToStaticMarkup(
      <KeepAlive active={false}>
        <span data-child>child</span>
      </KeepAlive>,
    );
    expect(html).toBe('');
  });

  test('renders visible host when active', () => {
    const html = renderToStaticMarkup(
      <KeepAlive active className="h-full" data-slot="host">
        <span data-child>child</span>
      </KeepAlive>,
    );
    expect(html).toContain('data-slot="host"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('data-child');
    expect(html).not.toContain('hidden=""');
  });
});
