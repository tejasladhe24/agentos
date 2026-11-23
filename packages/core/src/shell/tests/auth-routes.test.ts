import { describe, expect, test } from 'bun:test';

import {
  collectPublicExtensionRoutes,
  isKnownAppPath,
  loginPathWithNext,
  matchPublicAuthRoute,
  matchPublicExtensionRoute,
  normalizePathname,
  readNextParam,
  readResetToken,
  type PublicExtensionRoute,
} from '@agentos/core/shell/lib';
import type { RegistryModel } from '@agentos/core/vite/lib/types';

describe('auth routes', () => {
  const flags = { allowSignUp: true, allowPasswordReset: true };

  test('normalizePathname strips trailing slash', () => {
    expect(normalizePathname('/login/')).toBe('/login');
    expect(normalizePathname('/')).toBe('/');
  });

  test('matchPublicAuthRoute respects flags', () => {
    expect(matchPublicAuthRoute('/login', flags)).toBe('login');
    expect(matchPublicAuthRoute('/register', flags)).toBe('register');
    expect(
      matchPublicAuthRoute('/register', { ...flags, allowSignUp: false }),
    ).toBeNull();
    expect(
      matchPublicAuthRoute('/forgot-password', {
        ...flags,
        allowPasswordReset: false,
      }),
    ).toBeNull();
    expect(matchPublicAuthRoute('/', flags)).toBeNull();
  });

  test('isKnownAppPath only accepts workspace root', () => {
    expect(isKnownAppPath('/')).toBe(true);
    expect(isKnownAppPath('')).toBe(true);
    expect(isKnownAppPath('/totally-missing')).toBe(false);
    expect(isKnownAppPath('/__public/logo.svg')).toBe(false);
    expect(isKnownAppPath('/login')).toBe(false);
  });

  test('loginPathWithNext drops unknown next paths', () => {
    expect(loginPathWithNext('/crm')).toBe('/login');
    expect(loginPathWithNext('/totally-missing')).toBe('/login');
    expect(loginPathWithNext('/')).toBe('/login');
    expect(loginPathWithNext('/login')).toBe('/login');
  });

  test('read query helpers', () => {
    expect(readNextParam('?next=%2Fhome')).toBe('/home');
    expect(readNextParam('?next=https://evil')).toBeNull();
    expect(readResetToken('?token=abc')).toBe('abc');
  });

  test('matchPublicExtensionRoute exact and prefix', () => {
    const routes: PublicExtensionRoute[] = [
      {
        path: '/p/demo',
        extensionId: 'demo',
        view: 'page',
        iframeSrc: '/__agentos/ext/demo/page.html',
      },
      {
        path: '/p/trust/*',
        extensionId: 'trust',
        view: 'page',
        iframeSrc: '/__agentos/ext/trust/page.html',
      },
    ];
    expect(matchPublicExtensionRoute('/p/demo', routes)?.extensionId).toBe(
      'demo',
    );
    expect(matchPublicExtensionRoute('/p/demo/', routes)?.extensionId).toBe(
      'demo',
    );
    expect(matchPublicExtensionRoute('/p/demo/extra', routes)).toBeNull();
    expect(matchPublicExtensionRoute('/p/trust', routes)?.extensionId).toBe(
      'trust',
    );
    expect(
      matchPublicExtensionRoute('/p/trust/acme', routes)?.extensionId,
    ).toBe('trust');
    expect(matchPublicExtensionRoute('/login', routes)).toBeNull();
  });

  test('collectPublicExtensionRoutes reads meta.public.ui', () => {
    const registry = {
      scannedAt: 1,
      extensions: [
        {
          id: 'demo',
          kind: 'customer',
          driven: false,
          toggleable: true,
          rootDir: '/tmp/demo',
          name: 'Demo',
          meta: {
            public: {
              ui: [{ path: '/p/demo', view: 'page' }],
              apiPrefixes: ['/portal/'],
            },
          },
          ui: {},
          uiEntries: { page: '/__agentos/ext/demo/page.html' },
          agent: {},
          agentDescriptors: { tools: [], skills: [] },
        },
      ],
    } as RegistryModel;

    expect(collectPublicExtensionRoutes(registry)).toEqual([
      {
        path: '/p/demo',
        extensionId: 'demo',
        view: 'page',
        iframeSrc: '/__agentos/ext/demo/page.html',
      },
    ]);
  });
});
