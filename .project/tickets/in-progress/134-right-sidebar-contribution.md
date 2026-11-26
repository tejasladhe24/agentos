# 134 — Right sidebar UI contribution entrypoint (`ui/right-sidebar`) and Files details migration

**Status:** in-progress

## Goal

Add a resizable **right sidebar** UI contribution entrypoint to the AgentOS Shell, with `ui/right-sidebar.{tsx,ts,jsx,js}` as the reserved convention file (parallel to `ui/sidebar`), and replace the custom internal right sidebar details panel in builtin `files` with the Shell right sidebar.

## Depends on

- Ticket **39** (Contextual left sidebar + Shell panels) — done
- Ticket **46** (Hide empty active-extension UI contrib hosts) — done
- Ticket **96** (Files Drive-style UI) — done

## Scope

1. **Reserved UI view (`right-sidebar`):**
   - Extend `UiViewName` (`packages/core/src/vite/lib/types.ts`) and `ExtensionView` (`packages/core/src/shell/lib/ui-contribs/contribution.ts`) with `'right-sidebar'`.
   - Scan `ui/right-sidebar.{tsx,ts,jsx,js}` in `scanExtensions`, emit `/__agentos/ext/<id>/right-sidebar.html` in `enrichRegistry` / Vite plugin / gateway HTML handler, and map it in `applyRegistry`.
2. **Shell right sidebar host (resizable, active-extension):**
   - Add `rightSidebarOpen`, `setRightSidebarOpen`, and `toggleRightSidebar` to `useShellStore` (default `false`).
   - Add `rightSidebarColumnHasContent` / `rightSidebarColumnVisible`, `useShellRightSidebarOpen`, and `RightSidebarSlot` (`data-slot="right-sidebar"`).
   - Wire a resizable right `ResizablePanel` + `ResizableHandle` in `ShellRoot` that collapses to `0` when closed or when the active view has no `ui/right-sidebar` contribution (never remounting `MainWorkspace`).
   - Add a right-sidebar toggle button in `TopBar` (`top-bar-end`) when the active view contributes a right sidebar.
3. **HostAPI / Client SDK control (`host.ui` / `useHostUi`):**
   - Add `ui: { setRightSidebarOpen, toggleRightSidebar, isRightSidebarOpen }` to `HostAPI` (`@agentos/core/sdk`), wire it in `createShellHostApi`, `proxyHostApi`, `hostApiFromRemote`, `createLazyHostProxy`, and `createStandaloneHost`, and export `useHostUi` from `@agentos/core/client`.
4. **Files builtin migration (`packages/core/builtins/files/ui/`):**
   - Add `packages/core/builtins/files/ui/right-sidebar.tsx` hosting `FilesDetail` + file preview/download logic.
   - Share selected items across `page.tsx` and `right-sidebar.tsx` via host storage + `BroadcastChannel` (`use-files-selection.ts`) and sync open/close state with `useHostUi`.
   - Remove the custom `ResizablePanelGroup` / `FilesDetail` panel from `packages/core/builtins/files/ui/page.tsx`.
5. **Docs & tests:**
   - Update `.project/docs/extensions.md` and `.project/docs/architecture.md` to document `ui/right-sidebar.tsx`.
   - Add/update unit tests for scanner, HTML entry, registry mapping, `RightSidebarSlot`, `rightSidebarColumnHasContent`, `ShellRoot`, `TopBar`, `createShellHostApi`, and `files`.

## Out of scope

- Global / multi-extension right sidebar panels (v1 is active-extension only, matching `ui/sidebar.tsx`).
- Migrating other builtins (e.g. Email or Notifications) in this ticket.

## Done when

- [x] `ui/right-sidebar.{tsx,ts,jsx,js}` is scanned, enriched, served at `/__agentos/ext/<id>/right-sidebar.html`, and built into production bundles
- [x] Shell renders a resizable right sidebar panel (`RightSidebarSlot`) that collapses cleanly when closed or when the active view has no `right-sidebar` contribution
- [x] TopBar exposes a right-sidebar toggle when the active view contributes `right-sidebar`
- [x] Extensions can open/close/toggle/query the right sidebar via `useHostUi()` (`@agentos/core/client`)
- [x] Builtin `files` uses `ui/right-sidebar.tsx` for its details/preview panel instead of an internal `ResizablePanelGroup`
- [x] Unit tests cover scanner, gateway/vite HTML entries, Shell right sidebar, HostAPI `ui`, and `files`
- [x] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` → open **Files** → select a file → click Info (`i`) or TopBar right-sidebar toggle → verify Shell right sidebar opens, resizes smoothly, previews/downloads the file, and closes cleanly via `X`, Info, or TopBar toggle
