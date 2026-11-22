import { createRoot, type Root } from 'react-dom/client';
import type { ComponentType } from 'react';
import { registry as virtualRegistry } from 'virtual:agentos-registry';
import type { RegistryModel } from '@agentos/core/vite/lib/types';
import { AuthGate, type AuthGateConfig } from './components/auth/auth-gate';
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
  config?: AuthGateConfig;
};

/** Mount the Core Shell workspace into `root` (auth-gated). */
export function mountShell(
  root: HTMLElement,
  options: MountShellOptions = {},
): void {
  applyRegistry(options.registry ?? virtualRegistry);
  restoreStoredActivity();
  void hydrateEnableStateFromGateway().then(() => {
    restoreStoredActivity();
  });

  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  activeRoot = createRoot(root);
  activeRoot.render(
    <AuthGate
      dashboard={options.dashboard}
      dashboardSidebar={options.dashboardSidebar}
      config={options.config}
    />,
  );
}
