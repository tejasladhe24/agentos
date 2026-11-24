import type { ShellView, SidebarPanel } from '../chrome/store';
import type { UiContribution } from './contribution';

export type SidebarColumnContentInput = {
  sidebarPanel: SidebarPanel;
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
 * Used so ShellRoot can keep the resizable layout + main canvas mounted while
 * the user toggles the column closed — only collapse the sidebar panel.
 *
 * Active-extension host: in contribution mode, no content when the active view
 * has nothing (no Home `dashboardSidebar`, no matching `ui/sidebar.tsx`).
 * Shell panels (extensions / hitl) and the Settings view always count as content.
 */
export function sidebarColumnHasContent({
  sidebarPanel,
  activeView,
  sidebars,
  hasDashboardSidebar,
}: SidebarColumnContentInput): boolean {
  if (sidebarPanel !== 'contribution') return true;
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
