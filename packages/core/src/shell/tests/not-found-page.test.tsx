import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AuthGate, NotFoundPage } from '@agentos/core/shell/components';

const testConfig = {
  auth: {
    allowSignUp: true,
    allowPasswordReset: true,
    afterSignInPath: '/',
  },
  branding: {
    appName: 'Acme App',
  },
};

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

describe('AuthGate not-found', () => {
  test('unknown pathname renders Not Found outside Shell', () => {
    const html = renderToStaticMarkup(
      createElement(AuthGate, {
        config: testConfig,
        initialPathname: '/totally-missing',
      }),
    );
    expect(html).toContain('data-agentos-not-found');
    expect(html).toContain('404 - Not Found');
    expect(html).toContain('Acme App');
    expect(html).not.toContain('data-agentos-shell');
    expect(html).not.toContain('Welcome back');
  });

  test('typo /__public path renders Not Found', () => {
    const html = renderToStaticMarkup(
      createElement(AuthGate, {
        config: testConfig,
        initialPathname: '/__public/logo.svg',
      }),
    );
    expect(html).toContain('data-agentos-not-found');
    expect(html).not.toContain('data-agentos-shell');
  });

  test('declared public extension path renders portal without login', () => {
    const html = renderToStaticMarkup(
      createElement(AuthGate, {
        config: testConfig,
        initialPathname: '/p/demo',
        publicRoutes: [
          {
            path: '/p/demo',
            extensionId: 'demo',
            view: 'page',
            iframeSrc: '/__agentos/ext/demo/page.html',
          },
        ],
      }),
    );
    expect(html).toContain('data-agentos-public-portal');
    expect(html).toContain('data-extension-id="demo"');
    expect(html).toContain('/__agentos/ext/demo/page.html');
    expect(html).not.toContain('data-agentos-not-found');
    expect(html).not.toContain('Welcome back');
    expect(html).not.toContain('data-agentos-shell');
  });
});
