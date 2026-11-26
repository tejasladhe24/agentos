# 137 — Right-side sheet panel UI contribution entrypoint (`ui/right-sheet`)

**Status:** in-progress

## Goal

Add a **global right-side sheet panel** UI contribution entrypoint (`ui/right-sheet.{tsx,ts,jsx,js}`) to the AgentOS Shell so any enabled builtin or customer extension can register an overlay drawer accessible from anywhere in the workspace—distinct from `ui/right-sidebar.tsx` (which is an inline, active-extension-only column).

## Depends on

- Ticket **134** (`ui/right-sidebar` contribution pattern) — in progress

## Scope

1. **Reserved UI view (`right-sheet`):**
   - Extend `UiViewName` (`packages/core/src/vite/lib/types.ts`) and `ExtensionView` (`packages/core/src/shell/lib/ui-contribs/contribution.ts`) with `'right-sheet'`.
   - Scan `ui/right-sheet.{tsx,ts,jsx,js}` in `scanExtensions`, emit `/__agentos/ext/<id>/right-sheet.html` in `enrichRegistry` / Vite plugin / production gateway HTML handler, and map it in `applyRegistry`.
   - Add optional `rightSheet?: { label?: string; description?: string; icon?: string }` metadata to `ExtensionMeta` (`meta.json`) for the TopBar trigger tooltip/icon and Sheet header (falling back to extension `name` and `icon`).
2. **Shell global right sheet host (`RightSheetSlot`):**
   - Add `activeRightSheet: string | null` (extension id, or `null` when closed), `openRightSheet(extensionId)`, `closeRightSheet()`, and `toggleRightSheet(extensionId)` to `useShellStore`.
   - When an extension is disabled (`setExtensionEnabled(id, false)` / `hydrateEnabledById`), close the sheet if it was showing that extension.
   - Add `RightSheetSlot` (`packages/core/src/shell/components/ui-contribs/right-sheet-slot.tsx`) rendered inside `ShellRoot` using `@agentos/ui/components/sheet` (`Sheet`, `SheetContent` with `side="right"`, `SheetHeader`, `SheetTitle`, `SheetDescription`).
   - Host enabled `right-sheet` contributions in `ExtensionFrame` inside the sheet without ever remounting `MainWorkspace`.
   - Render trigger icon buttons in `TopBar` (`top-bar-end`) for each enabled extension contributing `ui/right-sheet`, with tooltips and `aria-pressed` state.
3. **HostAPI / Client SDK (`host.ui` / `useHostUi`):**
   - Extend `HostAPI['ui']` (`@agentos/core/sdk`) with `openRightSheet(extensionId?)`, `closeRightSheet()`, `toggleRightSheet(extensionId?)`, and `getActiveRightSheet()` (defaulting `extensionId` to the calling extension).
   - Wire through `createShellHostApi`, `proxyHostApi`, `hostApiFromRemote`, `createLazyHostProxy`, and `createStandaloneHost`, and expose via `useHostUi` (`@agentos/core/client`).
4. **Docs & tests:**
   - Update `.project/docs/extensions.md` and `.project/docs/architecture.md` to document `ui/right-sheet.tsx` and the distinction between active-extension `ui/right-sidebar.tsx` and global `ui/right-sheet.tsx`.
   - Add unit tests for scanner, Vite/gateway HTML entries, registry mapping, `useShellStore`, `RightSheetSlot`, `TopBar` triggers, and `createShellHostApi`.

## Out of scope

- Building the Notifications inbox UI itself (covered by ticket **138**).
- Putting `activeRightSheet` in the browser URL (transient chrome state stays store-driven).

## Done when

- [ ] `ui/right-sheet.{tsx,ts,jsx,js}` is scanned, enriched, served at `/__agentos/ext/<id>/right-sheet.html`, and built into production bundles
- [ ] `TopBar` (`top-bar-end`) renders a trigger button for each enabled builtin/extension that contributes `ui/right-sheet`
- [ ] Clicking a trigger opens `@agentos/ui` `<Sheet side="right">` hosting that extension's `ExtensionFrame` over any active workspace page without remounting `MainWorkspace`
- [ ] Disabling an extension closes its right sheet if currently open and removes its TopBar trigger
- [ ] Extensions can open/close/toggle/query right sheets via `useHostUi()` (`@agentos/core/client`)
- [ ] Unit tests cover scanner, gateway/vite HTML entries, `RightSheetSlot`, `TopBar`, store, and `HostAPI`
- [ ] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` → verify a `ui/right-sheet` contribution appears as an icon button in `TopBar` (`top-bar-end`), opens a right-side `<Sheet>` over Home/Settings/extension pages, and closes cleanly via Escape, backdrop click, close button, or TopBar toggle
