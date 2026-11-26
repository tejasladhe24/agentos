import { createRoot, type Root } from 'react-dom/client';
import type { ComponentType } from 'react';
import { registry as virtualRegistry } from 'virtual:agentos-registry';
import type { RegistryModel } from '@agentos/core/vite/lib/types';
import {
  AppRouter,
  type AppRouterConfig,
} from './components/routing/app-router';
import { restoreStoredActivity } from './lib/chrome/activity-bar-persistence';
import {
  applyRegistry,
  hydrateEnableStateFromGateway,
} from './lib/chrome/apply-registry';

let activeRoot: Root | null = null;

export type MountShellOptions = {
  /**
   * Override the Vite virtual registry (tests / non-Vite hosts).
   * Defaults to `import { registry } from 'virtual:agentos-registry'`.
   */
  registry?: RegistryModel;
  /**
   * App-owned Home page component (convention: `ui/dashboard.tsx` next to
   * `extensions/` / `services/`). Rendered in-process in the Shell Home pane.
   */
  dashboard?: ComponentType;
  /**
   * App-owned Home sidebar (convention: `ui/dashboard-sidebar.tsx`).
   * Rendered in-process in the left sidebar when `activeView === 'home'`.
   * Not an extension iframe / not a `UiViewName`.
   */
  dashboardSidebar?: ComponentType;
  /**
   * Override `virtual:agentos-config` (tests).
   */
  config?: AppRouterConfig;
};

/**
 * Restore the last Activity Bar selection only on a bare `/` visit — a deep
 * link (`/ext/<id>`, `/settings…`) must never be overridden.
 */
function restoreActivityAtRoot(): void {
  if (typeof window !== 'undefined' && window.location.pathname !== '/') {
    return;
  }
  restoreStoredActivity();
}

/** Mount the Core Shell (TanStack Router: auth, public portals, workspace). */
export function mountShell(
  root: HTMLElement,
  options: MountShellOptions = {},
): void {
  const registry = options.registry ?? virtualRegistry;
  applyRegistry(registry);
  restoreActivityAtRoot();
  void hydrateEnableStateFromGateway().then(() => {
    restoreActivityAtRoot();
  });

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  activeRoot = createRoot(root);
  activeRoot.render(
    <AppRouter
      dashboard={options.dashboard}
      dashboardSidebar={options.dashboardSidebar}
      config={options.config}
      registry={registry}
    />,
  );
}
