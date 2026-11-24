import type { ComponentType } from 'react';
import {
  useShellActiveView,
  useShellContributions,
  useShellSidebarOpen,
  useShellSidebarPanel,
} from '@agentos/core/shell/hooks';
import {
  contributionKey,
  type ShellView,
  type SidebarPanel,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { cn } from '@agentos/ui/lib/utils';
import { ExtensionManagerPanel } from '../chrome/extension-manager-drawer';
import { HitlInbox } from '../chrome/hitl-inbox';
import { SettingsSidebar } from '../settings/settings-sidebar';
import { ExtensionFrame } from './extension-frame';
import { KeepAlive } from './keep-alive';

export type SidebarSlotProps = {
  contributions?: UiContribution[];
  sidebarOpen?: boolean;
  /** Override store active view (tests / controlled hosts). */
  activeView?: ShellView;
  /** Override store sidebar panel mode (tests / controlled hosts). */
  sidebarPanel?: SidebarPanel;
  /** App Home sidebar (`ui/dashboard-sidebar.tsx`), in-process. */
  dashboardSidebar?: ComponentType;
};

/** Left sidebar host: active extension `ui/sidebar.tsx`, Home sidebar, Settings nav, or Shell manager/HITL. */
export function SidebarSlot({
  contributions: contributionsProp,
  sidebarOpen: sidebarOpenProp,
  activeView: activeViewProp,
  sidebarPanel: sidebarPanelProp,
  dashboardSidebar: DashboardSidebar,
}: SidebarSlotProps) {
  const sidebarOpen = useShellSidebarOpen(sidebarOpenProp);
  const activeView = useShellActiveView(activeViewProp);
  const storePanel = useShellSidebarPanel();
  const mode = sidebarPanelProp ?? storePanel;
  const sidebars = useShellContributions({
    contributions: contributionsProp,
    view: 'sidebar',
  });

  const contributionMode = mode === 'contribution';
  const homeSidebarActive =
    contributionMode && activeView === 'home' && DashboardSidebar != null;
  const settingsSidebarActive = contributionMode && activeView === 'settings';

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground',
        !sidebarOpen && 'hidden',
      )}
      data-slot="sidebar"
      data-sidebar-panel={mode}
      data-open={sidebarOpen ? 'true' : 'false'}
      aria-label="Sidebar"
      hidden={!sidebarOpen}
    >
      <KeepAlive
        active={mode === 'extensions'}
        className="min-h-0 flex-1 overflow-hidden"
        data-slot="extension-manager-host"
      >
        <ExtensionManagerPanel />
      </KeepAlive>
      <KeepAlive
        active={mode === 'hitl'}
        className="min-h-0 flex-1 overflow-hidden"
        data-slot="hitl-inbox-host"
      >
        <HitlInbox />
      </KeepAlive>
      <div
        className={cn(
          'min-h-0 flex-1 overflow-hidden',
          !contributionMode && 'hidden',
        )}
        hidden={!contributionMode}
      >
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
          const active =
            contributionMode && contribution.extensionId === activeView;
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
