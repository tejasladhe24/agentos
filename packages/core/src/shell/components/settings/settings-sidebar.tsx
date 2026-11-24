import { Fragment, useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import {
  useSettingsItems,
  type UseSettingsItemsOptions,
} from '@agentos/core/shell/hooks';
import {
  fetchAuthSession,
  groupSettingsItems,
  searchSettings,
  type AuthSessionOk,
} from '@agentos/core/shell/lib';
import { Avatar, AvatarFallback } from '@agentos/ui/components/avatar';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';
import { Separator } from '@agentos/ui/components/separator';
import { cn } from '@agentos/ui/lib/utils';

export type SettingsSidebarProps = UseSettingsItemsOptions & {
  /** Initial search query (tests / deep links). */
  initialQuery?: string;
};

const NAV_BUTTON_CLASS =
  'w-full justify-start gap-2.5 px-2.5 text-xs font-normal text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground';
const NAV_BUTTON_ACTIVE_CLASS =
  'bg-sidebar-accent font-medium text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';

/**
 * Settings navigation hosted in the Shell's left SidebarSlot (same column as
 * Extensions / Approvals). Items come from enabled extensions that register
 * `ui/settings.tsx`; selecting one drives the main Settings view.
 *
 * Typing in the search box switches to fuzzy results that include individual
 * settings (entries) inside each section, not just the section names.
 */
export function SettingsSidebar(props: SettingsSidebarProps = {}) {
  const { initialQuery = '', ...itemOptions } = props;
  const { items, activeItem, activeEntryId, select, contributions } =
    useSettingsItems(itemOptions);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [authUser, setAuthUser] = useState<AuthSessionOk['user'] | null>(null);

  const hasAuthSettings = contributions.some((c) => c.extensionId === 'auth');

  useEffect(() => {
    if (!hasAuthSettings || typeof fetch === 'undefined') return;
    let cancelled = false;
    void fetchAuthSession().then((res) => {
      if (!cancelled && res) {
        setAuthUser(res.user);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasAuthSettings]);

  const searching = searchQuery.trim().length > 0;
  const groups = useMemo(() => groupSettingsItems(items), [items]);
  const results = useMemo(
    () => (searching ? searchSettings(items, searchQuery) : []),
    [items, searchQuery, searching],
  );

  const userInitial =
    (authUser?.name?.trim() || authUser?.email?.trim())?.[0]?.toUpperCase() ??
    '?';

  return (
    <div
      data-slot="settings-sidebar"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <div className="flex shrink-0 flex-col gap-3 px-3 pt-4 pb-2">
        {authUser ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const firstAuth = items.find((i) => i.extensionId === 'auth');
              if (firstAuth) select(firstAuth.key);
            }}
            className="h-auto w-full justify-start gap-2.5 px-2 py-1.5 text-left hover:bg-sidebar-accent/60"
            data-slot="settings-account-summary"
          >
            <Avatar size="default">
              <AvatarFallback className="text-xs font-medium">
                {userInitial}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium">
                {authUser.email}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {authUser.name}
              </span>
            </div>
          </Button>
        ) : (
          <div className="px-2 py-1">
            <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
          </div>
        )}

        <div className="relative">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder="Search settings"
            aria-label="Search settings"
            className="pl-8"
          />
        </div>
      </div>

      <nav
        aria-label="Settings sections"
        data-slot="settings-sidebar-nav"
        data-mode={searching ? 'search' : 'browse'}
        className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4"
      >
        {searching ? (
          results.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No matching settings
            </p>
          ) : (
            <ul
              className="flex flex-col gap-0.5"
              data-slot="settings-search-results"
            >
              {results.map(({ key, item, entry }) => {
                const active = entry
                  ? activeItem?.key === item.key && activeEntryId === entry.id
                  : activeItem?.key === item.key && activeEntryId === null;
                const IconComponent = item.Icon;
                return (
                  <li key={key}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-current={active ? 'page' : undefined}
                      data-settings-result={key}
                      data-settings-key={item.key}
                      data-settings-entry={entry?.id}
                      data-active={active ? 'true' : 'false'}
                      onClick={() => select(item.key, entry?.id ?? null)}
                      className={cn(
                        'h-auto min-h-8 w-full items-start justify-start gap-2.5 px-2.5 py-1.5 text-left text-xs font-normal text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                        active && NAV_BUTTON_ACTIVE_CLASS,
                      )}
                    >
                      <IconComponent
                        className="mt-0.5 size-4 shrink-0"
                        weight={active ? 'fill' : 'regular'}
                        aria-hidden="true"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-foreground">
                          {entry ? entry.label : item.label}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {entry ? `${item.group} › ${item.label}` : item.group}
                        </span>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )
        ) : groups.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No extension settings registered
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((group, groupIndex) => (
              <Fragment key={group.group}>
                {groupIndex > 0 ? <Separator className="my-1" /> : null}
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = activeItem?.key === item.key;
                    const IconComponent = item.Icon;
                    return (
                      <li key={item.key}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-current={active ? 'page' : undefined}
                          data-settings-key={item.key}
                          data-settings-extension={item.extensionId}
                          data-settings-section={item.sectionId}
                          data-active={active ? 'true' : 'false'}
                          onClick={() => select(item.key)}
                          className={cn(
                            NAV_BUTTON_CLASS,
                            active && NAV_BUTTON_ACTIVE_CLASS,
                          )}
                        >
                          <IconComponent
                            className="size-4 shrink-0"
                            weight={active ? 'fill' : 'regular'}
                            aria-hidden="true"
                          />
                          <span className="truncate">{item.label}</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Fragment>
            ))}
          </div>
        )}
      </nav>
    </div>
  );
}
