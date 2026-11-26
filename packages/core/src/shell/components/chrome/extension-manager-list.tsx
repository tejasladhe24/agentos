import {
  FunnelIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { useShellExtensions } from '@agentos/core/shell/hooks';
import {
  deriveExtensionManagerStatus,
  resolveExtensionIcon,
  useShellStore,
  type ContributionRuntimeStatus,
  type ExtensionEntry,
  type ExtensionManagerStatus,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@agentos/ui/components/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@agentos/ui/components/input-group';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import { Switch } from '@agentos/ui/components/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

export type ExtensionManagerListProps = {
  /** Override catalog (tests / controlled hosts). */
  extensions?: ExtensionEntry[];
  enabledById?: Record<string, boolean>;
  contributions?: UiContribution[];
  runtimeStatus?: Record<string, ContributionRuntimeStatus>;
  onSetEnabled?: (extensionId: string, enabled: boolean) => void;
};

const STATUS_LABEL: Record<ExtensionManagerStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  loading: 'Loading',
  crashed: 'Crashed',
};

const STATUS_VARIANT: Record<
  ExtensionManagerStatus,
  'secondary' | 'outline' | 'destructive'
> = {
  active: 'secondary',
  disabled: 'outline',
  loading: 'outline',
  crashed: 'destructive',
};

function ExtensionRow({
  entry,
  enabled,
  contributions,
  runtimeStatus,
  onSetEnabled,
}: {
  entry: ExtensionEntry;
  enabled: boolean;
  contributions: UiContribution[];
  runtimeStatus: Record<string, ContributionRuntimeStatus>;
  onSetEnabled: (extensionId: string, enabled: boolean) => void;
}) {
  const status = deriveExtensionManagerStatus(
    entry.id,
    enabled,
    contributions,
    runtimeStatus,
  );
  const locked = !entry.toggleable;
  const ExtIcon = resolveExtensionIcon(entry.icon);

  return (
    <TableRow
      data-extension-id={entry.id}
      data-kind={entry.kind}
      data-status={status}
      data-icon={entry.icon ?? 'Cube'}
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <ExtIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {entry.name}
              </span>
              {locked ? (
                <LockSimpleIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Locked"
                />
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">{entry.id}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="capitalize">
          {entry.kind}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
      </TableCell>
      <TableCell className="text-right">
        <Switch
          size="sm"
          checked={enabled}
          disabled={locked}
          aria-label={
            locked
              ? `${entry.name} is always on`
              : `${enabled ? 'Disable' : 'Enable'} ${entry.name}`
          }
          onCheckedChange={(checked) => {
            onSetEnabled(entry.id, checked);
          }}
        />
      </TableCell>
    </TableRow>
  );
}

/** Extensions catalog table with search + builtin filter (full-page Shell view). */
export function ExtensionManagerList(props: ExtensionManagerListProps = {}) {
  const storeExtensions = useShellExtensions();
  const storeEnabledById = useShellStore((s) => s.enabledById);
  const storeContributions = useShellStore((s) => s.contributions);
  const storeRuntimeStatus = useShellStore((s) => s.runtimeStatus);
  const setExtensionEnabled = useShellStore((s) => s.setExtensionEnabled);

  const extensions = props.extensions ?? storeExtensions;
  const enabledById = props.enabledById ?? storeEnabledById;
  const contributions = props.contributions ?? storeContributions;
  const runtimeStatus = props.runtimeStatus ?? storeRuntimeStatus;
  const onSetEnabled = props.onSetEnabled ?? setExtensionEnabled;

  const [searchQuery, setSearchQuery] = useState('');
  /** When false (default), builtins are hidden from the manager list. */
  const [showBuiltin, setShowBuiltin] = useState(false);

  const filteredExtensions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return extensions.filter((entry) => {
      if (!showBuiltin && entry.kind === 'builtin') return false;
      if (q === '') return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.id.toLowerCase().includes(q)
      );
    });
  }, [extensions, searchQuery, showBuiltin]);

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      data-slot="extension-manager-list"
    >
      <div className="flex shrink-0 items-center gap-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupInput
            placeholder="Search extensions…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search extensions"
          />
          <InputGroupAddon>
            <MagnifyingGlassIcon
              className="size-4 shrink-0 opacity-50"
              aria-hidden
            />
          </InputGroupAddon>
        </InputGroup>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Filter extensions"
                data-slot="extension-manager-filter"
                data-show-builtin={showBuiltin ? 'true' : 'false'}
              />
            }
          >
            <FunnelIcon
              className="size-4"
              weight={showBuiltin ? 'fill' : 'regular'}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel>View Selected</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={showBuiltin}
                onCheckedChange={(checked) => setShowBuiltin(checked === true)}
              >
                builtin
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border">
        <Table aria-label="Extension list">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredExtensions.map((entry) => (
              <ExtensionRow
                key={entry.id}
                entry={entry}
                enabled={enabledById[entry.id] !== false}
                contributions={contributions}
                runtimeStatus={runtimeStatus}
                onSetEnabled={onSetEnabled}
              />
            ))}
          </TableBody>
        </Table>
        {filteredExtensions.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No extensions match these filters.
          </p>
        ) : null}
      </ScrollArea>
    </div>
  );
}
