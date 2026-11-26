import { SidebarSimpleIcon } from '@phosphor-icons/react';
import {
  useShellActiveRightSheet,
  useShellActiveView,
  useShellContributions,
  useShellRightSidebarOpen,
  useShellSidebarOpen,
} from '@agentos/core/shell/hooks';
import {
  contributionKey,
  rightSidebarColumnHasContent,
  resolveExtensionIcon,
  useShellStore,
  type ExtensionEntry,
  type ShellView,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { Button } from '@agentos/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agentos/ui/components/tooltip';
import { cn } from '@agentos/ui/lib/utils';
import { config as agentosConfig } from 'virtual:agentos-config';

export type TopBarProps = {
  /** Override store / config values (SSR / tests). */
  sidebarOpen?: boolean;
  rightSidebarOpen?: boolean;
  /** Override store active right sheet extension id (`null` = closed). */
  activeRightSheet?: string | null;
  activeView?: ShellView;
  contributions?: UiContribution[];
  /** Override store extensions for right-sheet trigger labels/icons (SSR / tests). */
  extensions?: ExtensionEntry[];
  appName?: string;
  logoUrl?: string;
};

/**
 * Shell topbar chrome — full-width strip above the workspace row.
 *
 * Regions `top-bar-start` / `top-bar-center` / `top-bar-end` are reserved
 * **global** UI contribution hosts (symmetric to status-bar main/end).
 * `top-bar-end` hosts one trigger per enabled `ui/right-sheet.tsx` plus the
 * active-extension right sidebar toggle. Settings opens via Activity Bar
 * secondary (builtin `settings`).
 */
export function TopBar(props: TopBarProps = {}) {
  const {
    sidebarOpen: sidebarOpenProp,
    rightSidebarOpen: rightSidebarOpenProp,
    activeRightSheet: activeRightSheetProp,
    activeView: activeViewProp,
    contributions: contributionsProp,
    extensions: extensionsProp,
    appName: appNameProp,
    logoUrl: logoUrlProp,
  } = props;
  const sidebarOpen = useShellSidebarOpen(sidebarOpenProp);
  const rightSidebarOpen = useShellRightSidebarOpen(rightSidebarOpenProp);
  const activeRightSheet = useShellActiveRightSheet(activeRightSheetProp);
  const activeView = useShellActiveView(activeViewProp);
  const rightSidebars = useShellContributions({
    contributions: contributionsProp,
    view: 'right-sidebar',
  });
  const rightSheets = useShellContributions({
    contributions: contributionsProp,
    view: 'right-sheet',
  });
  const storeExtensions = useShellStore((s) => s.extensions);
  const extensions = extensionsProp ?? storeExtensions;
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const toggleRightSidebar = useShellStore((s) => s.toggleRightSidebar);
  const toggleRightSheet = useShellStore((s) => s.toggleRightSheet);
  const hasRightSidebar = rightSidebarColumnHasContent({
    activeView,
    rightSidebars,
  });

  const appName = appNameProp ?? agentosConfig.branding.appName;
  const logoUrl =
    logoUrlProp !== undefined ? logoUrlProp : agentosConfig.branding.logoUrl;

  return (
    <header
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-2.5 text-sm text-foreground"
      aria-label="Top bar"
      data-slot="top-bar"
    >
      <div
        className="flex shrink-0 items-center gap-1"
        data-slot="top-bar-start"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          data-slot="topbar-sidebar-toggle"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-pressed={sidebarOpen}
          onClick={() => toggleSidebar()}
        >
          <SidebarSimpleIcon className="size-4" weight="regular" />
        </Button>
      </div>

      <div
        className="flex min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden"
        data-slot="top-bar-center"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-6 w-auto max-w-[8rem] object-contain"
            data-slot="topbar-logo"
          />
        ) : null}
        <span
          className="truncate font-medium text-foreground"
          data-slot="topbar-app-name"
        >
          {appName}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1" data-slot="top-bar-end">
        <TooltipProvider>
          {rightSheets.map((contribution) => {
            const entry = extensions.find(
              (e) => e.id === contribution.extensionId,
            );
            const label =
              entry?.rightSheet?.label ??
              entry?.name ??
              contribution.extensionId;
            const Icon = resolveExtensionIcon(
              entry?.rightSheet?.icon ?? entry?.icon,
            );
            const pressed = activeRightSheet === contribution.extensionId;
            return (
              <Tooltip
                key={contributionKey(
                  contribution.extensionId,
                  contribution.view,
                )}
              >
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'size-8 text-muted-foreground',
                        pressed &&
                          'bg-sidebar-accent text-sidebar-accent-foreground',
                      )}
                      data-slot="topbar-right-sheet-toggle"
                      data-extension-id={contribution.extensionId}
                      aria-label={label}
                      aria-pressed={pressed}
                      onClick={() => toggleRightSheet(contribution.extensionId)}
                    />
                  }
                >
                  <Icon
                    className="size-4"
                    weight={pressed ? 'fill' : 'regular'}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
        {hasRightSidebar ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            data-slot="topbar-right-sidebar-toggle"
            aria-label={
              rightSidebarOpen
                ? 'Collapse right sidebar'
                : 'Expand right sidebar'
            }
            aria-pressed={rightSidebarOpen}
            onClick={() => toggleRightSidebar()}
          >
            <SidebarSimpleIcon
              className="size-4 -scale-x-100"
              weight="regular"
            />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
