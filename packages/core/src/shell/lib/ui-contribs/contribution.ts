/**
 * UI contribution view kinds (maps to `ui/page|sidebar|right-sidebar|right-sheet|widget|settings.tsx`).
 *
 * ## Host kinds
 *
 * - **Active-extension** hosts (e.g. left sidebar, right sidebar): show only
 *   the active extension’s contribution (`ui/sidebar.tsx`, `ui/right-sidebar.tsx`),
 *   or Home’s in-process `dashboardSidebar` on the left. When empty, the Shell
 *   collapses the host chrome — no empty column.
 * - **Global / multi-extension** hosts (e.g. status bar, topbar): may
 *   aggregate all enabled extensions and stay visible with Shell chrome even
 *   when some extensions contribute nothing. Topbar v1 is Shell chrome only
 *   (`top-bar-start` / `top-bar-center` / `top-bar-end` reserved for later).
 * - **Global overlay** host (`right-sheet`): one Sheet over the workspace.
 *   TopBar exposes a trigger per enabled `ui/right-sheet.tsx`; the open
 *   extension is tracked in the store (`activeRightSheet`), not the URL.
 *
 * App Home surfaces (`ui/dashboard.tsx`, `ui/dashboard-sidebar.tsx`) are
 * in-process via `mountShell` — not `ExtensionView` / iframe entries.
 */
export type ExtensionView =
  'page' | 'sidebar' | 'right-sidebar' | 'right-sheet' | 'widget' | 'settings';

/** Runtime lifecycle status for one mounted contribution frame. */
export type ContributionRuntimeStatus = 'loading' | 'active' | 'crashed';

/**
 * Declares a sandboxed iframe the Shell should mount.
 * `src` is typically `/__agentos/ext/<id>/<view>.html` (ticket 12);
 * `ExtensionFrame` appends `?theme=` from the Shell theme.
 */
export type UiContribution = {
  extensionId: string;
  view: ExtensionView;
  src: string;
};

/** Stable key for runtime status maps. */
export function contributionKey(
  extensionId: string,
  view: ExtensionView,
): string {
  return `${extensionId}:${view}`;
}
