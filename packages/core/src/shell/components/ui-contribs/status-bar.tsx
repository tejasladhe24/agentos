import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { useShellActiveView } from '@agentos/core/shell/hooks';
import {
  contributionKey,
  useShellStore,
  type ContributionRuntimeStatus,
  type ExtensionEntry,
  type UiContribution,
} from '@agentos/core/shell/lib';
import type { NotificationType } from '@agentos/core/sdk';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { Spinner } from '@agentos/ui/components/spinner';
import { Switch } from '@agentos/ui/components/switch';
import { useTheme } from '@agentos/ui/components/theme-provider';
import { cn } from '@agentos/ui/lib/utils';
import { config as agentosConfig } from 'virtual:agentos-config';
import { EnsureMounted } from './ensure-mounted';

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="flex items-center gap-1.5" data-slot="status-theme-toggle">
      <SunIcon
        className="size-3 dark:hidden"
        aria-hidden={isDark ? 'false' : 'true'}
      />
      <MoonIcon
        className="size-3 hidden dark:block"
        aria-hidden={isDark ? 'true' : 'false'}
      />
      <Switch
        size="sm"
        checked={isDark}
        aria-label="Toggle dark theme"
        title="Temporary theme toggle"
        onCheckedChange={(checked) => {
          setTheme(checked ? 'dark' : 'light');
        }}
      />
    </div>
  );
}

function countRuntime(
  runtimeStatus: Record<string, string>,
  status: string,
  /** When set, only count keys for currently mounted contributions. */
  mountedKeys?: Set<string>,
): number {
  return Object.entries(runtimeStatus).filter(([key, value]) => {
    if (value !== status) return false;
    if (mountedKeys && !mountedKeys.has(key)) return false;
    return true;
  }).length;
}

export type StatusBarProps = {
  /** Override store values (SSR / tests). */
  extensions?: ExtensionEntry[];
  enabledById?: Record<string, boolean>;
  contributions?: UiContribution[];
  runtimeStatus?: Record<string, ContributionRuntimeStatus>;
  statusText?: string | null;
  statusTone?: NotificationType | null;
};

/** Status bar chrome with notification text and runtime badges. */
export function StatusBar(props: StatusBarProps = {}) {
  const {
    extensions: extensionsProp,
    enabledById: enabledByIdProp,
    contributions: contributionsProp,
    runtimeStatus: runtimeStatusProp,
    statusText: statusTextProp,
    statusTone: statusToneProp,
  } = props;
  const activeView = useShellActiveView();
  const sidebarPanel = useShellStore((s) => s.sidebarPanel);
  const chatOpen = useShellStore((s) => s.chatOpen);
  const toggleChat = useShellStore((s) => s.toggleChat);
  const storeStatusText = useShellStore((s) => s.statusText);
  const storeStatusTone = useShellStore((s) => s.statusTone);
  const storeEnabledById = useShellStore((s) => s.enabledById);
  const storeExtensions = useShellStore((s) => s.extensions);
  const storeContributions = useShellStore((s) => s.contributions);
  const storeRuntimeStatus = useShellStore((s) => s.runtimeStatus);

  const statusText =
    statusTextProp !== undefined ? statusTextProp : storeStatusText;
  const statusTone =
    statusToneProp !== undefined ? statusToneProp : storeStatusTone;
  const enabledById = enabledByIdProp ?? storeEnabledById;
  const extensions = extensionsProp ?? storeExtensions;
  const contributions = contributionsProp ?? storeContributions;
  const runtimeStatus = runtimeStatusProp ?? storeRuntimeStatus;

  const mountedKeys = new Set(
    contributions.map((c) => contributionKey(c.extensionId, c.view)),
  );
  const enabledCustomers = extensions.filter(
    (e) => e.kind === 'customer' && enabledById[e.id] !== false,
  ).length;
  const customerTotal = extensions.filter((e) => e.kind === 'customer').length;
  const loadingCount = countRuntime(runtimeStatus, 'loading', mountedKeys);
  const crashedCount = countRuntime(runtimeStatus, 'crashed', mountedKeys);
  const isLoading = loadingCount > 0;

  return (
    <footer
      className="flex h-6 shrink-0 items-center gap-2 border-t border-border bg-sidebar px-2.5 text-xs text-muted-foreground"
      aria-label="Status bar"
      data-slot="status-bar"
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
        data-slot="status-bar-main"
      >
        <span className="shrink-0 font-medium text-foreground">
          {agentosConfig.branding.appName}
        </span>
        <Badge variant="outline">view: {activeView}</Badge>
        <Badge variant="secondary">panel: {sidebarPanel}</Badge>
        <Badge variant="outline" data-slot="status-enabled">
          enabled: {enabledCustomers}/{customerTotal}
        </Badge>
        {crashedCount > 0 ? (
          <Badge variant="destructive" data-slot="status-crashed">
            crashed: {crashedCount}
          </Badge>
        ) : null}
        {statusText ? (
          <span
            className={cn(
              'min-w-0 truncate',
              statusTone === 'error'
                ? 'text-destructive'
                : statusTone === 'warning'
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-foreground',
            )}
            data-slot="status-text"
            data-tone={statusTone ?? undefined}
            title={statusText}
          >
            {statusText}
          </span>
        ) : null}

        <Button
          type="button"
          variant={chatOpen ? 'secondary' : 'ghost'}
          size="xs"
          className="h-5 px-1.5 text-[11px]"
          data-slot="status-chat-toggle"
          aria-pressed={chatOpen}
          onClick={() => toggleChat()}
        >
          Chat
        </Button>

        <EnsureMounted>
          <ThemeToggle />
        </EnsureMounted>
      </div>

      <div
        className="flex shrink-0 items-center gap-1.5"
        data-slot="status-bar-end"
      >
        {/* Fixed end slot so extension status contributions never claim this space. */}
        <div
          className="flex size-4 shrink-0 items-center justify-center"
          data-slot="status-loading-slot"
          data-loading={isLoading ? 'true' : 'false'}
          aria-hidden={isLoading ? undefined : true}
        >
          {isLoading ? (
            <Spinner
              className="size-3"
              data-slot="status-loading"
              aria-label={`Loading ${loadingCount} contribution${loadingCount === 1 ? '' : 's'}`}
            />
          ) : null}
        </div>
      </div>
    </footer>
  );
}
