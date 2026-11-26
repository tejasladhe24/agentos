import { useEffect, useRef, type ComponentType } from 'react';
import {
  useShellActiveView,
  useShellContributions,
  useShellRightSidebarOpen,
  useShellSidebarOpen,
} from '@agentos/core/shell/hooks';
import {
  rightSidebarColumnHasContent,
  sidebarColumnHasContent,
  type ShellView,
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
import { ExtensionManagerView } from './extension-manager-view';
import { HiddenSlot } from '../ui-contribs/hidden-slot';
import { KeepAlive } from '../ui-contribs/keep-alive';
import { RightSheetSlot } from '../ui-contribs/right-sheet-slot';
import { RightSidebarSlot } from '../ui-contribs/right-sidebar-slot';
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

const RIGHT_SIDEBAR_DEFAULT_SIZE_PX = 320;
const RIGHT_SIDEBAR_MIN_SIZE_PX = 240;
const RIGHT_SIDEBAR_MAX_SIZE_PX = 480;

export type ShellRootProps = {
  /** App-owned Home page from `ui/dashboard.tsx`. */
  dashboard?: ComponentType;
  /** App-owned Home sidebar from `ui/dashboard-sidebar.tsx`. */
  dashboardSidebar?: ComponentType;
  /** Override store values (SSR / tests). */
  activeView?: ShellView;
  sidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
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
  const isExtensions = activeView === 'extensions';
  const isMainCanvas = !isHome && !isSettings && !isExtensions;

  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden bg-background">
      <div
        className="h-full w-full overflow-auto"
        data-active={isHome ? 'true' : 'false'}
        hidden={!isHome}
      >
        <HomeDashboard dashboard={dashboard} />
      </div>
      <KeepAlive active={isSettings} className="h-full w-full overflow-hidden">
        <SettingsView />
      </KeepAlive>
      <KeepAlive
        active={isExtensions}
        className="h-full w-full overflow-hidden"
        data-slot="extensions-view-host"
      >
        <ExtensionManagerView />
      </KeepAlive>
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
  rightSidebarOpen: rightSidebarOpenProp,
  contributions: contributionsProp,
}: ShellRootProps = {}) {
  const activeView = useShellActiveView(activeViewProp);
  const sidebarOpen = useShellSidebarOpen(sidebarOpenProp);
  const rightSidebarOpen = useShellRightSidebarOpen(rightSidebarOpenProp);
  const sidebars = useShellContributions({
    contributions: contributionsProp,
    view: 'sidebar',
  });
  const rightSidebars = useShellContributions({
    contributions: contributionsProp,
    view: 'right-sidebar',
  });
  // The panel group is always rendered (collapsed when empty) so swapping the
  // layout tree never remounts MainWorkspace / extension pages.
  const hasSidebarContent = sidebarColumnHasContent({
    activeView,
    sidebars,
    hasDashboardSidebar: dashboardSidebar != null,
  });
  const sidebarExpanded = sidebarOpen && hasSidebarContent;
  const hasRightSidebarContent = rightSidebarColumnHasContent({
    activeView,
    rightSidebars,
  });
  const rightSidebarExpanded = rightSidebarOpen && hasRightSidebarContent;
  const sidebarPanelRef = usePanelRef();
  const rightSidebarPanelRef = usePanelRef();
  /** Last expanded width so toggle-open restores a usable size (not min/collapsed). */
  const lastSidebarSizePxRef = useRef(SIDEBAR_DEFAULT_SIZE_PX);
  const lastRightSidebarSizePxRef = useRef(RIGHT_SIDEBAR_DEFAULT_SIZE_PX);

  useEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (sidebarExpanded) {
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
  }, [sidebarExpanded, sidebarPanelRef]);

  useEffect(() => {
    const panel = rightSidebarPanelRef.current;
    if (!panel) return;
    if (rightSidebarExpanded) {
      if (panel.isCollapsed()) {
        panel.expand();
      }
      panel.resize(lastRightSidebarSizePxRef.current);
    } else if (!panel.isCollapsed()) {
      const { inPixels } = panel.getSize();
      if (inPixels >= RIGHT_SIDEBAR_MIN_SIZE_PX) {
        lastRightSidebarSizePxRef.current = Math.min(
          RIGHT_SIDEBAR_MAX_SIZE_PX,
          inPixels,
        );
      }
      panel.collapse();
    }
  }, [rightSidebarExpanded, rightSidebarPanelRef]);

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
          <TopBar
            sidebarOpen={sidebarOpenProp}
            rightSidebarOpen={rightSidebarOpenProp}
            activeView={activeViewProp}
            contributions={contributionsProp}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <ActivityBar />
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 min-w-0 flex-1"
              data-sidebar-expanded={sidebarExpanded ? 'true' : 'false'}
              data-right-sidebar-expanded={
                rightSidebarExpanded ? 'true' : 'false'
              }
            >
              <ResizablePanel
                id="shell-sidebar"
                panelRef={sidebarPanelRef}
                collapsible
                collapsedSize={0}
                defaultSize={sidebarExpanded ? SIDEBAR_DEFAULT_SIZE_PX : 0}
                minSize={SIDEBAR_MIN_SIZE_PX}
                maxSize={SIDEBAR_MAX_SIZE_PX}
                className="min-h-0"
              >
                <SidebarSlot
                  dashboardSidebar={dashboardSidebar}
                  activeView={activeViewProp}
                  sidebarOpen={sidebarOpenProp}
                  contributions={contributionsProp}
                />
              </ResizablePanel>
              <ResizableHandle
                withHandle
                disabled={!sidebarExpanded}
                className={cn(!sidebarExpanded && 'hidden')}
              />
              <ResizablePanel
                id="shell-main"
                defaultSize="70%"
                minSize="40%"
                className="min-h-0 min-w-0"
              >
                <MainWorkspace activeView={activeView} dashboard={dashboard} />
              </ResizablePanel>
              <ResizableHandle
                withHandle
                disabled={!rightSidebarExpanded}
                className={cn(!rightSidebarExpanded && 'hidden')}
              />
              <ResizablePanel
                id="shell-right-sidebar"
                panelRef={rightSidebarPanelRef}
                collapsible
                collapsedSize={0}
                defaultSize={
                  rightSidebarExpanded ? RIGHT_SIDEBAR_DEFAULT_SIZE_PX : 0
                }
                minSize={RIGHT_SIDEBAR_MIN_SIZE_PX}
                maxSize={RIGHT_SIDEBAR_MAX_SIZE_PX}
                className="min-h-0"
              >
                <RightSidebarSlot
                  activeView={activeViewProp}
                  rightSidebarOpen={rightSidebarOpenProp}
                  contributions={contributionsProp}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
          <StatusBar />
          <ChatPanel />
          <HiddenSlot />
          <RightSheetSlot contributions={contributionsProp} />
          <CommandPalette />
        </div>
      </Toaster>
    </ThemeProvider>
  );
}
