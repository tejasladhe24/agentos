import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { NotFoundPage } from '@agentos/core/shell/components';

describe('NotFoundPage', () => {
  test('renders shadcn-style empty 404 with search and home link', () => {
    const html = renderToStaticMarkup(
      createElement(NotFoundPage, {
        branding: { appName: 'Acme App' },
      }),
    );
    expect(html).toContain('data-agentos-not-found');
    expect(html).toContain('404 - Not Found');
    expect(html).toContain('Acme App');
    expect(html).toContain('Try searching for pages...');
    expect(html).toContain('Go home');
    expect(html).toContain('data-slot="empty"');
    expect(html).toContain('data-slot="input-group"');
  });
});
