# 101 — Extension-registered Settings (sidebar, views, entry-level search)

**Status:** done

## Goal

Make **Settings** a Shell-owned, full-screen surface whose sections are **registered by extensions**, not hardcoded in the Settings layout. Move Auth account UI out of the Activity Bar into Settings, add a Shell-sidebar navigation with fuzzy search that can find **individual settings** (not just sections), and deep-link to them.

If an extension (e.g. Auth or Files) is disabled for a customer, its settings sections disappear automatically.

## Depends on

- Ticket **38** / **39** (Activity Bar secondary, contextual sidebar slot) — done
- Ticket **48** (builtin settings) / **50** (Auth account panel) — done; this ticket supersedes their UI placement
- Ticket **96** (Files UI) — in-progress; bin-retention preference moves to Files settings

## Scope

### 1. New `settings` extension view

- `ui/settings.tsx` is a fourth extension UI view (`UiViewName`/`ExtensionView` gain `'settings'`), loaded as a sandboxed iframe at `/__agentos/ext/<id>/settings.html` with the normal Comlink host API.
- Vite scanner, registry enrichment, HTML entry generation (Vite + gateway) and Shell `apply-registry` all recognise it.
- `meta.json` `settings: [{ id, label, description?, icon?, group?, keywords?, entries? }]` registers sidebar sections. An extension with `ui/settings.tsx` and no `meta.settings` auto-registers one section from its name/icon. Disabled extensions drop their contributions, so their sections vanish.

### 2. Shell Settings host

- Full-screen `SettingsView` (center content, `max-w-screen-md`) mounting the selected section's iframe; section is selected via `location.hash` (no iframe reload) through `ExtensionFrame`'s new `hash` prop.
- `SettingsSidebar` lives in the **Shell left `SidebarSlot`** (same column as Extensions / Approvals), scrollable, with account summary and grouped section nav.
- Shared selection in `useShellStore` (`settingsKey`, `settingsEntryId`) via `useSettingsItems`; last selection persisted.
- Settings Activity Bar item (`settings` builtin, secondary) opens it without needing a page contribution. `Buildings` icon added to the extension icon map.

### 3. Auth + Files move into Settings

- Auth: removed `ui/page.tsx`, `ui/sidebar.tsx` and the Activity Bar entry. New `ui/settings.tsx` with sections **Profile** (Profile + Security + Session) and **Organization** (Organization + Roles), built from shadcn **Field** primitives (no Cards).
- Files: bin auto-delete preference moved from the old Settings builtin page to Files `ui/settings.tsx` (choice-card radio group).
- Builtin `settings` no longer ships its own UI.

### 4. Entry-level fuzzy search

- `meta.json` `settings[].entries: [{ id, label, hint?, keywords? }]` — each individual setting carries a **plain-text search hint**.
- Dependency-free fuzzy scorer (`fuzzy.ts`): AND over query tokens; exact > prefix > substring > typo (edit distance) > anchored subsequence (`pwd` → password); weights label > keywords > hint > description.
- `searchSettings()` returns ranked section and entry hits; the sidebar shows flat results (`Group › Section` context) while a query is present.
- Selecting an entry result opens its section and passes `section:entry` as the iframe hash.
- `useSettingsTarget()` in `@agentos/core/client` reads the hash, scrolls to the `data-setting-entry="<id>"` element and flashes a ring.
- Entries declared: Auth (email, display-name, change-password, log-out, active-org, create-org, roles), Files (bin-retention).

## Out of scope

- Per-setting persistence changes (no API changes; Auth/Files APIs unchanged).
- Settings for customer extensions beyond the registration mechanism (they work via the same `ui/settings.tsx` + `meta.settings`).
- Re-scroll when the already-targeted entry is selected again.

## Done when

- [x] `ui/settings.tsx` recognised by scanner, registry, HTML entries, and Shell
- [x] Settings sidebar in Shell `SidebarSlot`, scrollable; full-screen center view
- [x] Sections come only from enabled extensions; none hardcoded in the Settings layout
- [x] Auth account UI lives under Settings (Profile / Organization); no Auth Activity Bar entry
- [x] Files bin retention lives in Files settings
- [x] UI uses `@agentos/ui` Field primitives; no Cards
- [x] Fuzzy search finds individual settings via entry hints; results deep-link and highlight
- [x] Tests: scanner/meta parsing, items/search/sidebar/view, sidebar slot + column visibility, `useSettingsTarget` parsing
- [x] Docs: `builtins.md` updated for Auth / Settings placement
- [x] `bun run ci` green

## Verify

- `pnpm install` then `bun run ci`
- `agentos dev` → Settings (Activity Bar secondary) → sidebar lists Profile, Organization, Files
- Search `pwd` → **Change password** → opens Profile and highlights the field; search `tenant` → Organization entries
- Disable Files → Files section disappears from Settings
