import { useEffect, useRef, type ComponentType } from 'react';
import {
  useShellActiveView,
  useShellContributions,
  useShellSidebarOpen,
  useShellSidebarPanel,
} from '@agentos/core/shell/hooks';
import {
  sidebarColumnHasContent,
  type ShellView,
  type SidebarPanel,
  type UiContribution,
} from '@agentos/core/shell/lib';
import {
  AGENTOS_THEMES,
  ThemeProvider,
} from '@agentos/ui/components/theme-provider';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from '@agentos/ui/components/resizable';
import { Toaster, toast } from '@agentos/ui/components/toast';
import { cn } from '@agentos/ui/lib/utils';
import { HomeDashboard } from '../home/home-dashboard';
import { SettingsView } from '../settings/settings-view';
import { HiddenSlot } from '../ui-contribs/hidden-slot';
import { SidebarSlot } from '../ui-contribs/sidebar-slot';
import { StatusBar } from '../ui-contribs/status-bar';
import { TopBar } from '../ui-contribs/top-bar';
import { ActivityBar } from './activity-bar';
import { ChatPanel } from './chat-panel';
import { CommandPalette } from './command-palette';
import { MainCanvas } from './main-canvas';
import '@agentos/ui/globals.css';

/** Default expanded sidebar width (px); also used after toggle if expand() undershoots. */
const SIDEBAR_DEFAULT_SIZE_PX = 256;
const SIDEBAR_MIN_SIZE_PX = 180;
const SIDEBAR_MAX_SIZE_PX = 480;

export type ShellRootProps = {
  /** App-owned Home page from `ui/dashboard.tsx`. */
  dashboard?: ComponentType;
  /** App-owned Home sidebar from `ui/dashboard-sidebar.tsx`. */
  dashboardSidebar?: ComponentType;
  /** Override store values (SSR / tests). */
  activeView?: ShellView;
  sidebarOpen?: boolean;
  sidebarPanel?: SidebarPanel;
  contributions?: UiContribution[];
};

function MainWorkspace({
  activeView,
  dashboard,
}: {
  activeView: ShellView;
  dashboard?: ComponentType;
}) {
  const isHome = activeView === 'home';
  const isSettings = activeView === 'settings';
  const isMainCanvas = !isHome && !isSettings;

  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden bg-background">
      <div
        className="h-full w-full overflow-auto"
        data-active={isHome ? 'true' : 'false'}
        hidden={!isHome}
      >
        <HomeDashboard dashboard={dashboard} />
      </div>
      {isSettings ? (
        <div className="h-full w-full overflow-hidden" data-active="true">
          <SettingsView />
        </div>
      ) : null}
      <div
        className="h-full w-full overflow-auto"
        data-active={isMainCanvas ? 'true' : 'false'}
        hidden={!isMainCanvas}
      >
        <MainCanvas />
      </div>
    </div>
  );
}

export function ShellRoot({
  dashboard,
  dashboardSidebar,
  activeView: activeViewProp,
  sidebarOpen: sidebarOpenProp,
  sidebarPanel: sidebarPanelProp,
  contributions: contributionsProp,
}: ShellRootProps = {}) {
  const activeView = useShellActiveView(activeViewProp);
  const sidebarOpen = useShellSidebarOpen(sidebarOpenProp);
  const storePanel = useShellSidebarPanel();
  const sidebarPanel = sidebarPanelProp ?? storePanel;
  const sidebars = useShellContributions({
    contributions: contributionsProp,
    view: 'sidebar',
  });
  // Allocate the resizable column when there is content — do not tear it down
  // on toggle, or MainCanvas / extension pages remount.
  const hasSidebarContent = sidebarColumnHasContent({
    sidebarPanel,
    activeView,
    sidebars,
    hasDashboardSidebar: dashboardSidebar != null,
  });
  const sidebarPanelRef = usePanelRef();
  /** Last expanded width so toggle-open restores a usable size (not min/collapsed). */
  const lastSidebarSizePxRef = useRef(SIDEBAR_DEFAULT_SIZE_PX);

  useEffect(() => {
    if (!hasSidebarContent) return;
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (sidebarOpen) {
      if (panel.isCollapsed()) {
        panel.expand();
      }
      // expand() often restores a tiny width; always apply the last open size.
      panel.resize(lastSidebarSizePxRef.current);
    } else if (!panel.isCollapsed()) {
      const { inPixels } = panel.getSize();
      if (inPixels >= SIDEBAR_MIN_SIZE_PX) {
        lastSidebarSizePxRef.current = Math.min(SIDEBAR_MAX_SIZE_PX, inPixels);
      }
      panel.collapse();
    }
  }, [hasSidebarContent, sidebarOpen, sidebarPanelRef]);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="agentos-theme"
      themes={[...AGENTOS_THEMES]}
    >
      <Toaster toastManager={toast} position="top-center">
        <div
          className="flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-background text-foreground"
          data-agentos-shell
        >
          <TopBar />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <ActivityBar />
            {hasSidebarContent ? (
              <ResizablePanelGroup
                orientation="horizontal"
                className="min-h-0 min-w-0 flex-1"
              >
                <ResizablePanel
                  id="shell-sidebar"
                  panelRef={sidebarPanelRef}
                  collapsible
                  collapsedSize={0}
                  defaultSize={sidebarOpen ? SIDEBAR_DEFAULT_SIZE_PX : 0}
                  minSize={SIDEBAR_MIN_SIZE_PX}
                  maxSize={SIDEBAR_MAX_SIZE_PX}
                  className="min-h-0"
                >
                  <SidebarSlot
                    dashboardSidebar={dashboardSidebar}
                    activeView={activeViewProp}
                    sidebarOpen={sidebarOpenProp}
                    sidebarPanel={sidebarPanelProp}
                    contributions={contributionsProp}
                  />
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  disabled={!sidebarOpen}
                  className={cn(!sidebarOpen && 'hidden')}
                />
                <ResizablePanel
                  id="shell-main"
                  defaultSize="70%"
                  minSize="40%"
                  className="min-h-0 min-w-0"
                >
                  <MainWorkspace
                    activeView={activeView}
                    dashboard={dashboard}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <MainWorkspace activeView={activeView} dashboard={dashboard} />
              </div>
            )}
          </div>
          <StatusBar />
          <ChatPanel />
          <HiddenSlot />
          <CommandPalette />
        </div>
      </Toaster>
    </ThemeProvider>
  );
}
