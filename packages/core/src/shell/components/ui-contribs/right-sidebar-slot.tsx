import {
  useShellActiveView,
  useShellContributions,
  useShellRightSidebarOpen,
} from '@agentos/core/shell/hooks';
import {
  contributionKey,
  type ShellView,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { cn } from '@agentos/ui/lib/utils';
import { ExtensionFrame } from './extension-frame';

export type RightSidebarSlotProps = {
  contributions?: UiContribution[];
  rightSidebarOpen?: boolean;
  /** Override store active view (tests / controlled hosts). */
  activeView?: ShellView;
};

/** Right sidebar host: active extension `ui/right-sidebar.tsx`. */
export function RightSidebarSlot({
  contributions: contributionsProp,
  rightSidebarOpen: rightSidebarOpenProp,
  activeView: activeViewProp,
}: RightSidebarSlotProps) {
  const rightSidebarOpen = useShellRightSidebarOpen(rightSidebarOpenProp);
  const activeView = useShellActiveView(activeViewProp);
  const rightSidebars = useShellContributions({
    contributions: contributionsProp,
    view: 'right-sidebar',
  });

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground',
        !rightSidebarOpen && 'hidden',
      )}
      data-slot="right-sidebar"
      data-open={rightSidebarOpen ? 'true' : 'false'}
      aria-label="Right sidebar"
      hidden={!rightSidebarOpen}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        {rightSidebars.map((contribution) => {
          const active =
            activeView !== 'home' &&
            activeView !== 'settings' &&
            contribution.extensionId === activeView;
          return (
            <div
              key={contributionKey(contribution.extensionId, contribution.view)}
              className={cn('h-full w-full', !active && 'hidden')}
              hidden={!active}
              data-right-sidebar-active={active ? 'true' : 'false'}
            >
              <ExtensionFrame
                contribution={contribution}
                visible={rightSidebarOpen && active}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
