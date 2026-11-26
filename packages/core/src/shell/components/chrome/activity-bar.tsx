import { useShellActiveView } from '@agentos/core/shell/hooks';
import {
  buildActivityBarSections,
  isAdminRoles,
  useShellStore,
  writeStoredActivity,
  type ActivityBarItem,
} from '@agentos/core/shell/lib';
import { Button } from '@agentos/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agentos/ui/components/tooltip';
import { cn } from '@agentos/ui/lib/utils';

function ActivityIconButton({
  item,
  current,
  onActivate,
}: {
  item: ActivityBarItem;
  current: boolean;
  onActivate: () => void;
}) {
  const { id, label, Icon } = item;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-activity-id={id}
            aria-label={label}
            aria-current={current ? 'true' : undefined}
            className={cn(
              'text-muted-foreground',
              current && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
            onClick={onActivate}
          />
        }
      >
        <Icon weight={current ? 'fill' : 'regular'} className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ActivityBar() {
  const activeView = useShellActiveView();
  const setActiveView = useShellStore((s) => s.setActiveView);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const extensions = useShellStore((s) => s.extensions);
  const enabledById = useShellStore((s) => s.enabledById);
  const contributions = useShellStore((s) => s.contributions);
  const sessionRoles = useShellStore((s) => s.sessionRoles);
  const isAdmin = isAdminRoles(sessionRoles);

  const { primary: primaryItems, secondary: secondaryItems } =
    buildActivityBarSections({
      extensions,
      enabledById,
      contributions,
      isAdmin,
    });

  function currentFor(item: ActivityBarItem): boolean {
    return activeView === item.id;
  }

  function activate(item: ActivityBarItem) {
    if (activeView === item.id) {
      toggleSidebar();
      return;
    }
    setActiveView(item.id);
    writeStoredActivity({ view: item.id });
  }

  return (
    <TooltipProvider>
      <nav
        className="flex h-full min-h-0 w-12 shrink-0 flex-col items-center overflow-hidden border-r border-border bg-sidebar py-2"
        aria-label="Activity bar"
      >
        <div
          data-slot="activity-bar-primary"
          className="flex w-full flex-col items-center gap-1"
        >
          {primaryItems.map((item) => (
            <ActivityIconButton
              key={item.id}
              item={item}
              current={currentFor(item)}
              onActivate={() => activate(item)}
            />
          ))}
        </div>
        <div
          data-slot="activity-bar-secondary"
          className="mt-auto flex w-full flex-col-reverse items-center gap-1"
        >
          {secondaryItems.map((item) => (
            <ActivityIconButton
              key={item.id}
              item={item}
              current={currentFor(item)}
              onActivate={() => activate(item)}
            />
          ))}
        </div>
      </nav>
    </TooltipProvider>
  );
}
