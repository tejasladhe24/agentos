import type { ShellView } from '../chrome/store';
import type { UiContribution } from './contribution';

export type SidebarColumnContentInput = {
  activeView: ShellView;
  /** Sidebar contributions (`view: 'sidebar'`). */
  sidebars: UiContribution[];
  /** App Home sidebar from `mountShell({ dashboardSidebar })`. */
  hasDashboardSidebar: boolean;
};

export type SidebarColumnVisibleInput = SidebarColumnContentInput & {
  sidebarOpen: boolean;
};

/**
 * Whether the left sidebar column has something to show (ignore open/closed).
 *
 * The left column only hosts context for the active view:
 * - Home → app `dashboardSidebar` (when provided)
 * - Settings → Shell settings navigation
 * - Extension page → that extension's `ui/sidebar.tsx`
 *
 * Full-page Shell views (`extensions`) and pages without a sidebar have no
 * content, so the column collapses. Used so ShellRoot can keep the resizable
 * layout + main canvas mounted while the user toggles the column closed.
 */
export function sidebarColumnHasContent({
  activeView,
  sidebars,
  hasDashboardSidebar,
}: SidebarColumnContentInput): boolean {
  if (activeView === 'home' && hasDashboardSidebar) return true;
  // Settings nav is Shell-hosted (extensions register sections, not a sidebar).
  if (activeView === 'settings') return true;
  return sidebars.some((c) => c.extensionId === activeView);
}

/**
 * Whether the sidebar column should appear expanded (`sidebarOpen` + content).
 */
export function sidebarColumnVisible({
  sidebarOpen,
  ...content
}: SidebarColumnVisibleInput): boolean {
  return sidebarOpen && sidebarColumnHasContent(content);
}
