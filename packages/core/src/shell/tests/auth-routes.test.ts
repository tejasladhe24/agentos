import { afterEach, describe, expect, test } from 'bun:test';

import {
  collectPublicExtensionRoutes,
  isKnownAppPath,
  loginPathWithNext,
  matchPublicAuthRoute,
  matchPublicExtensionRoute,
  navigateApp,
  normalizePathname,
  readNextParam,
  readResetToken,
  registerAppNavigator,
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

  test('isKnownAppPath accepts workspace paths only', () => {
    expect(isKnownAppPath('/')).toBe(true);
    expect(isKnownAppPath('')).toBe(true);
    expect(isKnownAppPath('/settings')).toBe(true);
    expect(isKnownAppPath('/extensions')).toBe(true);
    expect(isKnownAppPath('/ext/hitl')).toBe(true);
    expect(isKnownAppPath('/ext/crm')).toBe(true);
    expect(isKnownAppPath('/ext/crm/')).toBe(true);
    expect(isKnownAppPath('/ext')).toBe(false);
    expect(isKnownAppPath('/ext/crm/deeper')).toBe(false);
    expect(isKnownAppPath('/totally-missing')).toBe(false);
    expect(isKnownAppPath('/__public/logo.svg')).toBe(false);
    expect(isKnownAppPath('/login')).toBe(false);
  });

  test('loginPathWithNext carries known deep links, drops the rest', () => {
    expect(loginPathWithNext('/ext/crm')).toBe('/login?next=%2Fext%2Fcrm');
    expect(loginPathWithNext('/settings?section=files%3Astorage')).toBe(
      '/login?next=%2Fsettings%3Fsection%3Dfiles%253Astorage',
    );
    expect(loginPathWithNext('/crm')).toBe('/login');
    expect(loginPathWithNext('/totally-missing')).toBe('/login');
    expect(loginPathWithNext('/')).toBe('/login');
    expect(loginPathWithNext('/login')).toBe('/login');
    expect(loginPathWithNext(null)).toBe('/login');
  });

  test('read query helpers', () => {
    expect(readNextParam('?next=%2Fhome')).toBe('/home');
    expect(readNextParam('?next=%2Fext%2Fcrm')).toBe('/ext/crm');
    expect(readNextParam('?next=https://evil')).toBeNull();
    expect(readNextParam('?next=%2F%2Fevil.example')).toBeNull();
    expect(readNextParam('?next=%2F%5Cevil.example')).toBeNull();
    expect(readResetToken('?token=abc')).toBe('abc');
  });

  describe('navigateApp', () => {
    afterEach(() => registerAppNavigator(null));

    test('delegates to the registered router navigator', () => {
      const calls: string[] = [];
      registerAppNavigator((to) => calls.push(to));
      navigateApp('/ext/crm');
      navigateApp('/login');
      expect(calls).toEqual(['/ext/crm', '/login']);
    });
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
