import type { ComponentType } from 'react';
import {
  useShellActiveView,
  useShellContributions,
  useShellSidebarOpen,
} from '@agentos/core/shell/hooks';
import {
  contributionKey,
  type ShellView,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { cn } from '@agentos/ui/lib/utils';
import { SettingsSidebar } from '../settings/settings-sidebar';
import { ExtensionFrame } from './extension-frame';
import { KeepAlive } from './keep-alive';

export type SidebarSlotProps = {
  contributions?: UiContribution[];
  sidebarOpen?: boolean;
  /** Override store active view (tests / controlled hosts). */
  activeView?: ShellView;
  /** App Home sidebar (`ui/dashboard-sidebar.tsx`), in-process. */
  dashboardSidebar?: ComponentType;
};

/**
 * Left sidebar host. It only shows context for the active view: the Home
 * sidebar, Settings navigation, or the active extension's `ui/sidebar.tsx`.
 * Full-page Shell views (Extensions) and pages without a sidebar render no
 * content, and the column collapses via `sidebarColumnHasContent`.
 */
export function SidebarSlot({
  contributions: contributionsProp,
  sidebarOpen: sidebarOpenProp,
  activeView: activeViewProp,
  dashboardSidebar: DashboardSidebar,
}: SidebarSlotProps) {
  const sidebarOpen = useShellSidebarOpen(sidebarOpenProp);
  const activeView = useShellActiveView(activeViewProp);
  const sidebars = useShellContributions({
    contributions: contributionsProp,
    view: 'sidebar',
  });

  const homeSidebarActive = activeView === 'home' && DashboardSidebar != null;
  const settingsSidebarActive = activeView === 'settings';

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground',
        !sidebarOpen && 'hidden',
      )}
      data-slot="sidebar"
      data-open={sidebarOpen ? 'true' : 'false'}
      aria-label="Sidebar"
      hidden={!sidebarOpen}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        {DashboardSidebar != null ? (
          <KeepAlive
            active={homeSidebarActive}
            className="h-full w-full overflow-auto"
            data-slot="dashboard-sidebar"
            data-sidebar-active={homeSidebarActive ? 'true' : 'false'}
          >
            <DashboardSidebar />
          </KeepAlive>
        ) : null}
        <KeepAlive
          active={settingsSidebarActive}
          className="h-full w-full overflow-hidden"
          data-slot="settings-sidebar-host"
          data-sidebar-active={settingsSidebarActive ? 'true' : 'false'}
        >
          <SettingsSidebar />
        </KeepAlive>
        {sidebars.map((contribution) => {
          const active = contribution.extensionId === activeView;
          return (
            <div
              key={contributionKey(contribution.extensionId, contribution.view)}
              className={cn('h-full w-full', !active && 'hidden')}
              hidden={!active}
              data-sidebar-active={active ? 'true' : 'false'}
            >
              <ExtensionFrame
                contribution={contribution}
                visible={sidebarOpen && active}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
