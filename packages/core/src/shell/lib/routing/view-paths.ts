import type { ShellView } from '../chrome/store';
import { parseSearchString, stringifySearchRecord } from './search';

/** Path prefix for extension page views (`/ext/<extensionId>`). */
export const EXTENSION_PATH_PREFIX = '/ext/';

/**
 * Where a workspace URL points inside the Shell.
 * `section` / `entry` only apply to the `settings` view.
 */
export type RouteTarget = {
  view: ShellView;
  section?: string;
  entry?: string;
};

function trimTrailingSlash(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

/** Canonical workspace path for a Shell view. */
export function viewToPath(view: ShellView): string {
  if (view === 'home') return '/';
  if (view === 'settings') return '/settings';
  return `${EXTENSION_PATH_PREFIX}${encodeURIComponent(view)}`;
}

/**
 * Shell view for a workspace pathname, or `null` when the path is not a
 * workspace path (auth pages, public portals, unknown paths).
 */
export function pathToView(pathname: string): ShellView | null {
  const path = trimTrailingSlash(pathname);
  if (path === '/') return 'home';
  if (path === '/settings') return 'settings';
  if (!path.startsWith(EXTENSION_PATH_PREFIX)) return null;
  const id = path.slice(EXTENSION_PATH_PREFIX.length);
  if (!id || id.includes('/')) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

/** Parse a location into a {@link RouteTarget}; `null` for non-workspace paths. */
export function targetFromLocation(
  pathname: string,
  search: string,
): RouteTarget | null {
  const view = pathToView(pathname);
  if (view === null) return null;
  if (view !== 'settings') return { view };
  const params = parseSearchString(search);
  const section = params.section || undefined;
  return {
    view,
    section,
    // An entry only makes sense inside a section.
    entry: section ? params.entry || undefined : undefined,
  };
}

/** Canonical href (path + search) for a {@link RouteTarget}. */
export function targetHref(target: RouteTarget): string {
  const path = viewToPath(target.view);
  if (target.view !== 'settings') return path;
  return `${path}${stringifySearchRecord({
    section: target.section,
    entry: target.section ? target.entry : undefined,
  })}`;
}

/** True when two targets point at the same view / settings selection. */
export function targetsEqual(a: RouteTarget, b: RouteTarget): boolean {
  if (a.view !== b.view) return false;
  if (a.view !== 'settings') return true;
  return a.section === b.section && a.entry === b.entry;
}
