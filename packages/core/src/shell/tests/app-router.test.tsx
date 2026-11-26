import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider } from '@tanstack/react-router';
import {
  createAppRouter,
  type AppRouterConfig,
  type SessionFetcher,
} from '@agentos/core/shell/components';
import { useShellStore } from '@agentos/core/shell/lib';
import type { RegistryModel } from '@agentos/core/vite/lib/types';

const testConfig: AppRouterConfig = {
  auth: {
    allowSignUp: true,
    allowPasswordReset: true,
    afterSignInPath: '/',
  },
  branding: { appName: 'Acme App' },
};

function extension(id: string, uiEntries: Record<string, string>) {
  return {
    id,
    kind: 'customer',
    driven: false,
    toggleable: true,
    rootDir: `/tmp/${id}`,
    name: id,
    meta: {},
    ui: {},
    uiEntries,
    agent: {},
    agentDescriptors: { tools: [], skills: [] },
  };
}

const registry = {
  scannedAt: 1,
  extensions: [
    extension('crm', { page: '/__agentos/ext/crm/page.html' }),
    // Builtin Approvals page (ticket 136) at `/ext/hitl`.
    extension('hitl', { page: '/__agentos/ext/hitl/page.html' }),
    // No `ui/page` → not a valid `/ext/<id>` target.
    extension('sidebar-only', {
      sidebar: '/__agentos/ext/sidebar-only/sidebar.html',
    }),
  ],
} as unknown as RegistryModel;

const signedIn: SessionFetcher = async () => ({ roles: ['admin'] });
const signedInViewer: SessionFetcher = async () => ({ roles: ['viewer'] });
const signedOut: SessionFetcher = async () => null;
const sessionError: SessionFetcher = async () => {
  throw new Error('network down');
};

async function renderAt(
  path: string,
  options: {
    fetchSession?: SessionFetcher;
    publicRoutes?: Parameters<typeof createAppRouter>[0] extends infer O
      ? O extends { publicRoutes?: infer P }
        ? P
        : never
      : never;
    config?: AppRouterConfig;
  } = {},
) {
  const app = createAppRouter({
    config: options.config ?? testConfig,
    registry,
    publicRoutes: options.publicRoutes,
    initialPathname: path,
    fetchSession: options.fetchSession ?? signedOut,
  });
  // bun has no `document`, so TanStack defaults to server mode where
  // `navigate()` is a no-op and redirects are not followed. Run in client
  // mode (with in-memory history) to match the browser.
  app.router.update({ isServer: false, origin: 'http://localhost' });
  await app.router.load();
  return {
    router: app.router,
    history: app.history,
    sync: app.sync,
    // Lazy: once `RouterProvider` renders, TanStack's React transition hooks
    // wait for a real commit, so navigation-only tests must not render.
    get html() {
      return renderToStaticMarkup(<RouterProvider router={app.router} />);
    },
  };
}

describe('AppRouter route table', () => {
  beforeEach(() => {
    useShellStore.setState({
      activeView: 'home',
      settingsKey: null,
      settingsEntryId: null,
      enabledById: {},
      sessionRoles: null,
    });
  });

  describe('Not Found (outside Shell chrome)', () => {
    test('unknown pathname', async () => {
      const { html } = await renderAt('/totally-missing');
      expect(html).toContain('data-agentos-not-found');
      expect(html).toContain('404 - Not Found');
      expect(html).toContain('Acme App');
      expect(html).not.toContain('data-agentos-shell');
      expect(html).not.toContain('Welcome back');
    });

    test('typo /__public path', async () => {
      const { html } = await renderAt('/__public/logo.svg');
      expect(html).toContain('data-agentos-not-found');
      expect(html).not.toContain('data-agentos-shell');
    });

    test('/ext/<unknown> when signed in', async () => {
      const { html } = await renderAt('/ext/nope', { fetchSession: signedIn });
      expect(html).toContain('data-agentos-not-found');
      expect(html).not.toContain('data-agentos-shell');
    });

    test('/ext/<id> without a ui/page entry', async () => {
      const { html } = await renderAt('/ext/sidebar-only', {
        fetchSession: signedIn,
      });
      expect(html).toContain('data-agentos-not-found');
    });

    test('/ext/<id>/extra is not a workspace path', async () => {
      const { html } = await renderAt('/ext/crm/extra', {
        fetchSession: signedIn,
      });
      expect(html).toContain('data-agentos-not-found');
    });
  });

  describe('public auth routes', () => {
    test('/login renders the login page without Shell chrome', async () => {
      const { html } = await renderAt('/login');
      expect(html).toContain('Welcome back');
      expect(html).not.toContain('data-agentos-shell');
    });

    test('/register is Not Found when sign-up is disabled', async () => {
      const { html } = await renderAt('/register', {
        config: {
          ...testConfig,
          auth: { ...testConfig.auth, allowSignUp: false },
        },
      });
      expect(html).toContain('data-agentos-not-found');
    });

    test('/forgot-password is Not Found when password reset is disabled', async () => {
      const { html } = await renderAt('/forgot-password', {
        config: {
          ...testConfig,
          auth: { ...testConfig.auth, allowPasswordReset: false },
        },
      });
      expect(html).toContain('data-agentos-not-found');
    });

    test('signed-in users are redirected from /login to afterSignInPath', async () => {
      const { router } = await renderAt('/login', { fetchSession: signedIn });
      expect(router.state.location.pathname).toBe('/');
    });

    test('a session lookup error keeps the user on the public page', async () => {
      const { html, router } = await renderAt('/login', {
        fetchSession: sessionError,
      });
      expect(router.state.location.pathname).toBe('/login');
      expect(html).toContain('Welcome back');
    });
  });

  describe('public extension portals', () => {
    const publicRoutes = [
      {
        path: '/p/demo',
        extensionId: 'demo',
        view: 'page' as const,
        iframeSrc: '/__agentos/ext/demo/page.html',
      },
      {
        path: '/p/trust/*',
        extensionId: 'trust',
        view: 'page' as const,
        iframeSrc: '/__agentos/ext/trust/page.html',
      },
    ];

    test('declared path renders the portal without a session check', async () => {
      const { html } = await renderAt('/p/demo', { publicRoutes });
      expect(html).toContain('data-agentos-public-portal');
      expect(html).toContain('data-extension-id="demo"');
      expect(html).toContain('/__agentos/ext/demo/page.html');
      expect(html).toContain('data-slot="public-portal-loading"');
      expect(html).toContain('data-loading="true"');
      expect(html).not.toContain('data-agentos-not-found');
      expect(html).not.toContain('Welcome back');
      expect(html).not.toContain('data-agentos-shell');
    });

    test('prefix pattern matches nested paths', async () => {
      const { html } = await renderAt('/p/trust/acme', { publicRoutes });
      expect(html).toContain('data-extension-id="trust"');
    });

    test('undeclared sibling path is Not Found', async () => {
      const { html } = await renderAt('/p/other', { publicRoutes });
      expect(html).toContain('data-agentos-not-found');
    });
  });

  describe('workspace (signed out)', () => {
    test('deep link redirects to /login with ?next=', async () => {
      const { router } = await renderAt('/ext/crm');
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.searchStr).toBe('?next=%2Fext%2Fcrm');
    });

    test('/extensions requires sign-in and returns there after', async () => {
      const { router } = await renderAt('/extensions');
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.searchStr).toBe('?next=%2Fextensions');
    });

    test('settings deep link keeps its search in ?next=', async () => {
      const { router } = await renderAt('/settings?section=files%3Astorage');
      expect(router.state.location.pathname).toBe('/login');
      expect(
        new URLSearchParams(router.state.location.searchStr).get('next'),
      ).toBe('/settings?section=files%3Astorage');
    });

    test('Home redirects to a bare /login', async () => {
      const { router } = await renderAt('/');
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.searchStr).toBe('');
    });

    test('a session lookup error is treated as signed out', async () => {
      const { router } = await renderAt('/ext/crm', {
        fetchSession: sessionError,
      });
      expect(router.state.location.pathname).toBe('/login');
    });

    test('clears sessionRoles', async () => {
      useShellStore.setState({ sessionRoles: null });
      await renderAt('/ext/crm');
      expect(useShellStore.getState().sessionRoles).toBeNull();
    });
  });

  describe('workspace (signed in)', () => {
    test('/ renders the Shell with Home active', async () => {
      const { html } = await renderAt('/', { fetchSession: signedIn });
      expect(html).toContain('data-agentos-shell');
      expect(html).toContain('data-slot="dashboard"');
      expect(useShellStore.getState().sessionRoles).toEqual(['admin']);
    });

    test('/ext/<id> renders the Shell and activates that view before render', async () => {
      const { html, router } = await renderAt('/ext/crm', {
        fetchSession: signedIn,
      });
      expect(router.state.location.pathname).toBe('/ext/crm');
      expect(html).toContain('data-agentos-shell');
      expect(html).not.toContain('data-agentos-not-found');
      expect(useShellStore.getState().activeView).toBe('crm');
    });

    test('/settings?section=… seeds the settings selection', async () => {
      const { html } = await renderAt(
        '/settings?section=files%3Astorage&entry=s3',
        {
          fetchSession: signedIn,
        },
      );
      expect(html).toContain('data-agentos-shell');
      const state = useShellStore.getState();
      expect(state.activeView).toBe('settings');
      expect(state.settingsKey).toBe('files:storage');
      expect(state.settingsEntryId).toBe('s3');
    });

    test('/ext/home and /ext/settings redirect to their canonical paths', async () => {
      const home = await renderAt('/ext/home', { fetchSession: signedIn });
      expect(home.router.state.location.pathname).toBe('/');
      const settings = await renderAt('/ext/settings', {
        fetchSession: signedIn,
      });
      expect(settings.router.state.location.pathname).toBe('/settings');
    });

    test('/ext/hitl renders the Approvals page as a workspace view', async () => {
      const { html, router } = await renderAt('/ext/hitl', {
        fetchSession: signedIn,
      });
      expect(router.state.location.pathname).toBe('/ext/hitl');
      expect(html).toContain('data-agentos-shell');
      expect(useShellStore.getState().activeView).toBe('hitl');
    });

    test('/extensions renders the Extensions Manager for an admin', async () => {
      const { html, router } = await renderAt('/extensions', {
        fetchSession: signedIn,
      });
      expect(router.state.location.pathname).toBe('/extensions');
      expect(html).toContain('data-agentos-shell');
      // SSR reads zustand's initial state, so the view is asserted on the store.
      expect(useShellStore.getState().activeView).toBe('extensions');
    });

    test('/extensions redirects a non-admin to Home', async () => {
      const { router } = await renderAt('/extensions', {
        fetchSession: signedInViewer,
      });
      expect(router.state.location.pathname).toBe('/');
      expect(useShellStore.getState().activeView).toBe('home');
    });

    test('/ext/extensions redirects to the canonical /extensions path', async () => {
      const { router } = await renderAt('/ext/extensions', {
        fetchSession: signedIn,
      });
      expect(router.state.location.pathname).toBe('/extensions');
    });

    test('a trailing slash still matches the workspace route', async () => {
      const { html } = await renderAt('/ext/crm/', { fetchSession: signedIn });
      expect(html).toContain('data-agentos-shell');
      expect(useShellStore.getState().activeView).toBe('crm');
    });

    test('roles are fetched once; later navigations skip the session lookup', async () => {
      let calls = 0;
      const counting: SessionFetcher = async () => {
        calls += 1;
        return { roles: ['admin'] };
      };
      const { router, history } = await renderAt('/', {
        fetchSession: counting,
      });
      expect(calls).toBe(1);

      // `<RouterProvider>` normally reloads on history changes; drive it by hand.
      history.push('/ext/crm');
      await router.load();
      expect(router.state.location.pathname).toBe('/ext/crm');
      history.push('/settings');
      await router.load();
      expect(router.state.location.pathname).toBe('/settings');

      expect(calls).toBe(1);
    });

    test('reserved search values are never JSON-coerced', async () => {
      const { router } = await renderAt('/reset-password?token=1e5');
      expect(router.state.location.searchStr).toBe('?token=1e5');
    });
  });
});
