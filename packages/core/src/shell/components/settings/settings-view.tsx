import {
  useSettingsItems,
  type UseSettingsItemsOptions,
} from '@agentos/core/shell/hooks';
import { contributionKey } from '@agentos/core/shell/lib';
import { cn } from '@agentos/ui/lib/utils';

import { ExtensionFrame } from '../ui-contribs/extension-frame';

export type SettingsViewProps = UseSettingsItemsOptions;

/**
 * Shell-hosted Settings main view — shows the section selected in the
 * Settings sidebar (left Shell column). Only enabled extensions that register
 * `ui/settings.tsx` are mounted, so disabling an extension removes its
 * settings automatically.
 */
export function SettingsView(props: SettingsViewProps = {}) {
  const { activeItem, activeEntryId, contributions } = useSettingsItems(props);
  // `section` or `section:entry` — extensions read it via `useSettingsTarget`.
  const hash = activeItem
    ? activeEntryId
      ? `${activeItem.sectionId}:${activeEntryId}`
      : activeItem.sectionId
    : undefined;

  return (
    <section
      className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground"
      data-slot="settings-view"
      aria-label="Settings"
    >
      <main
        className="mt-20 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-slot="settings-content"
      >
        {activeItem ? (
          <div className="mx-auto flex h-full min-h-0 w-full max-w-screen-md flex-col overflow-hidden">
            <header className="shrink-0 border-b border-border/60 px-6 py-5">
              <h1 className="text-xl font-semibold tracking-tight">
                {activeItem.label}
              </h1>
              {activeItem.description ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeItem.description}
                </p>
              ) : null}
            </header>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {contributions.map((contribution) => {
                const visible =
                  activeItem.extensionId === contribution.extensionId;
                return (
                  <div
                    key={contributionKey(
                      contribution.extensionId,
                      contribution.view,
                    )}
                    className={cn('h-full w-full', !visible && 'hidden')}
                    hidden={!visible}
                    aria-hidden={!visible}
                  >
                    <ExtensionFrame
                      contribution={contribution}
                      visible={visible}
                      hash={visible ? hash : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            No settings available
          </div>
        )}
      </main>
    </section>
  );
}
