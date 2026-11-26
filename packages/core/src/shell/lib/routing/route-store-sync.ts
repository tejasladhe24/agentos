import type { RouterHistory } from '@tanstack/react-router';
import { writeStoredActivity } from '../chrome/activity-bar-persistence';
import { useShellStore } from '../chrome/store';
import { writeStoredSettingsKey } from '../settings/settings-selection';
import {
  isShellPathView,
  targetFromLocation,
  targetHref,
  targetsEqual,
  type RouteTarget,
} from './view-paths';

/** The slice of TanStack's history the controller needs (fakeable in tests). */
export type RouteHistory = Pick<
  RouterHistory,
  'location' | 'push' | 'replace' | 'subscribe'
>;

export type RouteStoreSync = {
  /**
   * One-time, synchronous startup reconcile. Call **before** the first render
   * so the Shell never paints the wrong view:
   * - deep link (`/ext/<id>`, `/settings…`) → store follows the URL;
   * - bare `/` with a restored Activity Bar selection → URL follows the store.
   */
  bootstrap: () => void;
  /** Apply the current URL to the store (idempotent). */
  applyLocation: () => void;
  /** Subscribe both directions; returns an unsubscribe function. */
  start: () => () => void;
};

function currentUrlTarget(history: RouteHistory): RouteTarget | null {
  return targetFromLocation(history.location.pathname, history.location.search);
}

/** Store → target. Settings carries the selected section / entry. */
export function storeTarget(): RouteTarget {
  const state = useShellStore.getState();
  if (state.activeView !== 'settings') return { view: state.activeView };
  const section = state.settingsKey ?? undefined;
  return {
    view: 'settings',
    section,
    entry: section ? (state.settingsEntryId ?? undefined) : undefined,
  };
}

/**
 * Keeps the browser URL and the Shell store (`activeView`, settings selection)
 * in sync. The store stays the source of truth for rendering — extension
 * iframes remain mounted — while the URL is the shareable address of it.
 *
 * Only workspace paths are managed; on `/login`, public portals, or Not Found
 * the controller never navigates.
 */
export function createRouteStoreSync(history: RouteHistory): RouteStoreSync {
  /** True while one direction is writing, so the other ignores the echo. */
  let syncing = false;

  function guarded(fn: () => void): void {
    const wasSyncing = syncing;
    syncing = true;
    try {
      fn();
    } finally {
      syncing = wasSyncing;
    }
  }

  function applyLocation(): void {
    const url = currentUrlTarget(history);
    if (!url) return;

    const initial = useShellStore.getState();
    if (!isShellPathView(url.view) && initial.enabledById[url.view] === false) {
      // Disabled extension: fall back to Home instead of a blank canvas.
      history.replace('/');
      // `bootstrap()` runs before `start()` subscribes, so re-apply explicitly
      // (idempotent when the subscription already did).
      applyLocation();
      return;
    }

    guarded(() => {
      const state = useShellStore.getState();
      if (state.activeView !== url.view) {
        state.setActiveView(url.view);
        writeStoredActivity({ view: url.view });
      }
      // A URL without `section` means "unspecified" — keep the store's choice.
      if (url.view === 'settings' && url.section) {
        const settings = useShellStore.getState();
        if (
          settings.settingsKey !== url.section ||
          (settings.settingsEntryId ?? undefined) !== url.entry
        ) {
          settings.setSettingsKey(url.section, url.entry ?? null);
          writeStoredSettingsKey(url.section);
        }
      }
    });
  }

  function applyStore(): void {
    if (syncing) return;
    const url = currentUrlTarget(history);
    if (!url) return;
    const target = storeTarget();
    if (targetsEqual(url, target)) return;
    guarded(() => {
      const href = targetHref(target);
      // Same view, different settings selection → don't grow history.
      if (url.view === target.view) history.replace(href);
      else history.push(href);
    });
  }

  return {
    bootstrap() {
      if (!currentUrlTarget(history)) return;
      const atRoot = history.location.pathname === '/';
      const restored = useShellStore.getState().activeView !== 'home';
      if (atRoot && restored) {
        // Fresh visit to `/` — resume the last Activity Bar selection.
        guarded(() => history.replace(targetHref(storeTarget())));
        return;
      }
      applyLocation();
    },
    applyLocation,
    start() {
      const unsubscribeHistory = history.subscribe(() => {
        if (syncing) return;
        applyLocation();
      });
      const unsubscribeStore = useShellStore.subscribe(() => applyStore());
      return () => {
        unsubscribeHistory();
        unsubscribeStore();
      };
    },
  };
}
