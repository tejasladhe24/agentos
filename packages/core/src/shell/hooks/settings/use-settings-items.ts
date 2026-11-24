import { useCallback, useMemo } from 'react';
import {
  buildSettingsItems,
  resolveActiveSettingsItem,
  useShellStore,
  writeStoredSettingsKey,
  type ExtensionEntry,
  type SettingsNavItem,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { useShellContributions } from '../ui-contribs/use-shell-contributions';

export type UseSettingsItemsOptions = {
  /** Override store extensions (tests / controlled hosts). */
  extensions?: ExtensionEntry[];
  /** Override store contributions (tests / controlled hosts). */
  contributions?: UiContribution[];
  /** Override the selected section key (tests / controlled hosts). */
  selectedKey?: string;
  /** Override the targeted entry id inside the selected section. */
  selectedEntryId?: string;
};

export type UseSettingsItemsResult = {
  /** Settings sections registered by enabled extensions. */
  items: SettingsNavItem[];
  /** `view: 'settings'` contributions that should be mounted. */
  contributions: UiContribution[];
  activeItem: SettingsNavItem | null;
  /** Entry to scroll to inside `activeItem` (from a search result). */
  activeEntryId: string | null;
  select: (key: string, entryId?: string | null) => void;
};

/**
 * Single source of truth for Settings: sidebar (left Shell column) and the
 * main view both read the same registered items + selection from the store.
 */
export function useSettingsItems(
  options: UseSettingsItemsOptions = {},
): UseSettingsItemsResult {
  const storeExtensions = useShellStore((s) => s.extensions);
  const storeKey = useShellStore((s) => s.settingsKey);
  const storeEntryId = useShellStore((s) => s.settingsEntryId);
  const setSettingsKey = useShellStore((s) => s.setSettingsKey);
  const extensions = options.extensions ?? storeExtensions;
  const contributions = useShellContributions({
    contributions: options.contributions,
    view: 'settings',
  });

  const items = useMemo(
    () => buildSettingsItems({ extensions, contributions }),
    [extensions, contributions],
  );

  const activeItem = useMemo(
    () => resolveActiveSettingsItem(items, options.selectedKey ?? storeKey),
    [items, options.selectedKey, storeKey],
  );

  const requestedEntryId = options.selectedEntryId ?? storeEntryId;
  const activeEntryId =
    requestedEntryId &&
    activeItem?.entries.some((entry) => entry.id === requestedEntryId)
      ? requestedEntryId
      : null;

  const select = useCallback(
    (key: string, entryId?: string | null) => {
      setSettingsKey(key, entryId ?? null);
      writeStoredSettingsKey(key);
    },
    [setSettingsKey],
  );

  return { items, contributions, activeItem, activeEntryId, select };
}
