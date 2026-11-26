import { buildActivityBarSections } from './build-activity-bar-items';
import { isAdminRoles, type ShellView, useShellStore } from './store';

export const ACTIVITY_BAR_STORAGE_KEY = 'agentos-shell-activity';

export type StoredActivitySelection = {
  view: ShellView;
};

/**
 * Legacy overlay panels (ticket 136 removed `sidebarPanel`). An old entry that
 * pointed at one of these now means "open that page".
 */
const LEGACY_PANEL_VIEWS: Record<string, ShellView> = {
  extensions: 'extensions',
  hitl: 'hitl',
};

function canUseLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

/**
 * Read last Activity Bar selection. Accepts the pre-136 `{ view, panel }`
 * shape: an overlay `panel` becomes the view it used to sit on top of.
 */
export function readStoredActivity(): StoredActivitySelection | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(ACTIVITY_BAR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      view?: unknown;
      panel?: unknown;
    };
    if (typeof parsed.view !== 'string' || parsed.view === '') return null;
    const legacyView =
      typeof parsed.panel === 'string'
        ? LEGACY_PANEL_VIEWS[parsed.panel]
        : undefined;
    return { view: legacyView ?? parsed.view };
  } catch {
    return null;
  }
}

/** Persist last Activity Bar selection. */
export function writeStoredActivity(selection: StoredActivitySelection): void {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(
      ACTIVITY_BAR_STORAGE_KEY,
      JSON.stringify({ view: selection.view }),
    );
  } catch {
    // Quota / private mode — ignore.
  }
}

/**
 * Apply a stored selection to the Shell store when the target is still a
 * valid Activity Bar item (enabled + present). Falls back quietly otherwise.
 */
export function restoreStoredActivity(): StoredActivitySelection | null {
  const stored = readStoredActivity();
  if (!stored) return null;

  const state = useShellStore.getState();
  const { primary, secondary } = buildActivityBarSections({
    extensions: state.extensions,
    enabledById: state.enabledById,
    contributions: state.contributions,
    isAdmin: isAdminRoles(state.sessionRoles),
  });
  const allowed = [...primary, ...secondary].some(
    (item) => item.id === stored.view,
  );
  if (!allowed) return null;

  state.setActiveView(stored.view);
  return { view: stored.view };
}
