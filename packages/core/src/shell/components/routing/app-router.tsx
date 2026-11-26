import { useEffect, useState, type ComponentType } from 'react';
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  redirect,
  useRouterState,
  type RouterHistory,
} from '@tanstack/react-router';
import { z } from 'zod';
import { config as virtualConfig } from 'virtual:agentos-config';
import { registry as virtualRegistry } from 'virtual:agentos-registry';
import type { RegistryModel } from '@agentos/core/vite/lib/types';
import {
  applyBranding,
  collectPublicExtensionRoutes,
  createRouteStoreSync,
  fetchAuthSession,
  loginPathWithNext,
  matchPublicAuthRoute,
  matchPublicExtensionRoute,
  parseSearchString,
  registerAppNavigator,
  stringifySearchRecord,
  useShellStore,
  type PublicAuthRoute,
  type PublicExtensionRoute,
} from '@agentos/core/shell/lib';
import { ForgotPasswordPage } from '../auth/forgot-password-page';
import { LoginPage } from '../auth/login-page';
import { NotFoundPage } from '../auth/not-found-page';
import { PublicPortalHost } from '../auth/public-portal-host';
import { RegisterPage } from '../auth/register-page';
import { ResetPasswordPage } from '../auth/reset-password-page';
import { ShellRoot } from '../chrome/shell-root';

export type AppRouterBranding = {
  appName: string;
  logoUrl?: string;
  faviconUrl?: string;
  fontSans?: string;
  fontHeading?: string;
};

export type AppRouterConfig = {
  auth: {
    allowSignUp: boolean;
    allowPasswordReset: boolean;
    afterSignInPath: string;
  };
  branding: AppRouterBranding;
};

/** Resolves the signed-in session (`null` when signed out). */
export type SessionFetcher = () => Promise<{ roles: string[] } | null>;

export type CreateAppRouterOptions = {
  /** App-owned Home page (`ui/dashboard.tsx`). */
  dashboard?: ComponentType;
  /** App-owned Home sidebar (`ui/dashboard-sidebar.tsx`). */
  dashboardSidebar?: ComponentType;
  /** Override virtual config (tests). */
  config?: AppRouterConfig;
  /** Override virtual registry (tests). */
  registry?: RegistryModel;
  /**
   * Override public extension SPA routes (tests).
   * Defaults to routes collected from the registry.
   */
  publicRoutes?: PublicExtensionRoute[];
  /** Start at this pathname with in-memory history (tests / SSR). */
  initialPathname?: string;
  /** Override the session lookup (tests). Defaults to `fetchAuthSession`. */
  fetchSession?: SessionFetcher;
};

export type AppRouterProps = CreateAppRouterOptions;

function resolveConfig(override?: AppRouterConfig): AppRouterConfig {
  if (override) return override;
  return {
    auth: {
      allowSignUp: virtualConfig.auth.allowSignUp,
      allowPasswordReset: virtualConfig.auth.allowPasswordReset,
      afterSignInPath: virtualConfig.auth.afterSignInPath,
    },
    branding: {
      appName: virtualConfig.branding.appName,
      logoUrl: virtualConfig.branding.logoUrl,
      faviconUrl: virtualConfig.branding.faviconUrl,
      fontSans: virtualConfig.branding.fontSans,
      fontHeading: virtualConfig.branding.fontHeading,
    },
  };
}

function resolvePublicRoutes(
  override: PublicExtensionRoute[] | undefined,
  registry: RegistryModel,
): PublicExtensionRoute[] {
  if (override) return override;
  try {
    return collectPublicExtensionRoutes(registry);
  } catch {
    return [];
  }
}

const RenderNothing = () => null;

function LoadingScreen({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground"
      data-agentos-auth-loading
    >
      {label}
    </div>
  );
}

function PublicAuthPage({
  route,
  config,
}: {
  route: PublicAuthRoute;
  config: AppRouterConfig;
}) {
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const branding = {
    appName: config.branding.appName,
    logoUrl: config.branding.logoUrl,
  };
  switch (route) {
    case 'login':
      return (
        <LoginPage
          allowSignUp={config.auth.allowSignUp}
          allowPasswordReset={config.auth.allowPasswordReset}
          afterSignInPath={config.auth.afterSignInPath}
          search={search}
          branding={branding}
        />
      );
    case 'register':
      return (
        <RegisterPage
          afterSignInPath={config.auth.afterSignInPath}
          branding={branding}
        />
      );
    case 'forgot-password':
      return <ForgotPasswordPage branding={branding} />;
    case 'reset-password':
      return <ResetPasswordPage search={search} branding={branding} />;
  }
}

/** `navigateApp` target: push through router history, skipping no-ops. */
function navigateHistory(history: RouterHistory, to: string): void {
  const url = new URL(to, 'http://agentos.local');
  const current = history.location;
  if (url.pathname === current.pathname && url.search === current.search) {
    return;
  }
  history.push(`${url.pathname}${url.search}${url.hash}`);
}

/**
 * Build the Shell router (code-based route tree).
 *
 * - `_shell` (pathless layout) renders the Shell chrome behind a session
 *   guard. Its children (`/`, `/settings`, `/ext/$extensionId`) render
 *   nothing: extension iframes stay mounted in `MainCanvas`, driven by the
 *   store, and the URL↔store sync controller keeps both in step.
 * - Public auth pages, declared public extension portals, and Not Found live
 *   at the root, outside Shell chrome.
 */
export function createAppRouter(options: CreateAppRouterOptions = {}) {
  const config = resolveConfig(options.config);
  const registry: RegistryModel = options.registry ?? virtualRegistry;
  const publicRoutes = resolvePublicRoutes(options.publicRoutes, registry);
  const fetchSession: SessionFetcher = options.fetchSession ?? fetchAuthSession;
  const branding = {
    appName: config.branding.appName,
    logoUrl: config.branding.logoUrl,
  };

  const history =
    options.initialPathname != null
      ? createMemoryHistory({ initialEntries: [options.initialPathname] })
      : createBrowserHistory();

  // Align the store with the URL before the first render (no wrong-view flash).
  const sync = createRouteStoreSync(history);
  sync.bootstrap();

  async function requireSession(nextHref: string): Promise<void> {
    const store = useShellStore.getState();
    // Roles are loaded once per page; skip the round trip on view changes.
    if (store.sessionRoles !== null) return;
    let session: Awaited<ReturnType<SessionFetcher>> = null;
    try {
      session = await fetchSession();
    } catch {
      session = null;
    }
    if (!session) {
      store.setSessionRoles(null);
      throw redirect({ href: loginPathWithNext(nextHref) });
    }
    store.setSessionRoles(session.roles);
  }

  const rootRoute = createRootRoute({
    component: Outlet,
    notFoundComponent: () => <NotFoundPage branding={branding} />,
  });

  function ShellLayout() {
    useEffect(() => sync.start(), []);
    return (
      <>
        <ShellRoot
          dashboard={options.dashboard}
          dashboardSidebar={options.dashboardSidebar}
        />
        {/* Children render null; the Outlet lets their notFound() reach the root boundary. */}
        <Outlet />
      </>
    );
  }

  const shellRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_shell',
    beforeLoad: async ({ location }) => {
      await requireSession(location.href);
      sync.applyLocation();
    },
    pendingComponent: () => <LoadingScreen label="Checking session…" />,
    component: ShellLayout,
  });

  const homeRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: '/',
    pendingComponent: RenderNothing,
    component: RenderNothing,
  });

  const settingsRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: 'settings',
    validateSearch: z
      .object({
        section: z.string().optional(),
        entry: z.string().optional(),
      })
      .catch({}),
    pendingComponent: RenderNothing,
    component: RenderNothing,
  });

  const extensionRoute = createRoute({
    getParentRoute: () => shellRoute,
    path: 'ext/$extensionId',
    beforeLoad: ({ params }) => {
      const id = params.extensionId;
      // Home / Settings have canonical paths of their own.
      if (id === 'home') throw redirect({ href: '/' });
      if (id === 'settings') throw redirect({ href: '/settings' });
      const extension = registry.extensions.find((ext) => ext.id === id);
      if (!extension?.uiEntries.page) throw notFound();
    },
    pendingComponent: RenderNothing,
    component: RenderNothing,
  });

  function publicAuthRoute(route: PublicAuthRoute) {
    return createRoute({
      getParentRoute: () => rootRoute,
      path: `/${route}`,
      beforeLoad: async () => {
        if (matchPublicAuthRoute(`/${route}`, config.auth) === null) {
          throw notFound();
        }
        let session: Awaited<ReturnType<SessionFetcher>> = null;
        try {
          session = await fetchSession();
        } catch {
          session = null; // stay on the public page
        }
        if (session) {
          useShellStore.getState().setSessionRoles(session.roles);
          throw redirect({ href: config.auth.afterSignInPath });
        }
      },
      pendingComponent: () => <LoadingScreen label="Loading…" />,
      component: () => <PublicAuthPage route={route} config={config} />,
    });
  }

  function PublicPortal() {
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const search = useRouterState({ select: (s) => s.location.searchStr });
    const route = matchPublicExtensionRoute(pathname, publicRoutes);
    if (!route) return null;
    // No session check — rendered as soon as the route matches.
    return (
      <PublicPortalHost route={route} branding={branding} search={search} />
    );
  }

  // Catch-all: only declared public extension paths pass; everything else is
  // Not Found (reuses the unit-tested prefix / exact matcher).
  const portalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    beforeLoad: ({ location }) => {
      if (!matchPublicExtensionRoute(location.pathname, publicRoutes)) {
        throw notFound();
      }
    },
    component: PublicPortal,
  });

  const routeTree = rootRoute.addChildren([
    shellRoute.addChildren([homeRoute, settingsRoute, extensionRoute]),
    publicAuthRoute('login'),
    publicAuthRoute('register'),
    publicAuthRoute('forgot-password'),
    publicAuthRoute('reset-password'),
    portalRoute,
  ]);

  const router = createRouter({
    routeTree,
    history,
    // String-only search codec — never rewrite opaque values (reset tokens).
    parseSearch: parseSearchString,
    stringifySearch: stringifySearchRecord,
    defaultPendingMs: 100,
    defaultPendingMinMs: 0,
  });

  return { router, history, sync };
}

export type AppRouterInstance = ReturnType<typeof createAppRouter>;

/**
 * Shell root: owns routing for auth pages, public portals, Not Found, and the
 * Shell workspace (replaces the former `AuthGate`).
 */
export function AppRouter(props: AppRouterProps) {
  const [app] = useState(() => createAppRouter(props));
  const config = resolveConfig(props.config);

  useEffect(() => {
    applyBranding(config.branding);
  }, [
    config.branding.appName,
    config.branding.logoUrl,
    config.branding.faviconUrl,
    config.branding.fontSans,
    config.branding.fontHeading,
  ]);

  useEffect(() => {
    registerAppNavigator((to) => navigateHistory(app.history, to));
    return () => registerAppNavigator(null);
  }, [app]);

  return <RouterProvider router={app.router} />;
}
