import type { SettingsNavItem } from './build-settings-items';

export const SETTINGS_SELECTED_KEY = 'agentos-shell-settings-section';

/** Read the last selected Settings section key from localStorage. */
export function readStoredSettingsKey(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(SETTINGS_SELECTED_KEY);
  } catch {
    return null;
  }
}

/** Persist the selected Settings section key. */
export function writeStoredSettingsKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_SELECTED_KEY, key);
  } catch {
    // Quota / private mode — ignore.
  }
}

/**
 * Resolve the active Settings item: requested key → stored key → first item.
 * Stale keys (extension disabled / removed) fall through to the next option.
 */
export function resolveActiveSettingsItem(
  items: readonly SettingsNavItem[],
  key: string | null | undefined,
  storedKey: string | null = readStoredSettingsKey(),
): SettingsNavItem | null {
  const byKey = (k: string | null | undefined) =>
    k ? items.find((item) => item.key === k) : undefined;
  return byKey(key) ?? byKey(storedKey) ?? items[0] ?? null;
}
