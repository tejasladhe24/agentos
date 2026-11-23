import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostProvider, useHostStorage } from '@agentos/core/client';
import { createStubHost } from './stub-host';

describe('HostProvider', () => {
  test('provides injected host to descendants without iframe handshake', () => {
    const host = createStubHost();

    function Probe() {
      const storage = useHostStorage();
      return createElement('span', {
        'data-ok': typeof storage.get === 'function' ? '1' : '0',
      });
    }

    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        host,
        children: createElement(Probe),
      }),
    );

    expect(html).toContain('data-ok="1"');
  });

  test('renders LoadingState until a host is available (boot path without inject)', () => {
    // Outside an iframe, createExtensionClient would throw in useLayoutEffect.
    // SSR / static markup never runs layout effects, so children stay unmounted.
    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        children: createElement('span', { 'data-child': '1' }),
      }),
    );
    expect(html).toContain('data-slot="host-provider-loading"');
    expect(html).toContain('Connecting to host');
    expect(html).not.toContain('data-child');
  });
});
