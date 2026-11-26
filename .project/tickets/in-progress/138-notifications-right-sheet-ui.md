# 138 — Notifications extension right-sheet UI (`/recent` inbox)

**Status:** in-progress

## Goal

Register a `ui/right-sheet.tsx` contribution from builtin `notifications` so users can open the Notifications drawer from the TopBar on any page and inspect all recent in-app entries returned by `GET /api/ext/notifications/recent`.

## Depends on

- Ticket **61** (Durable HITL / notifications state) — done
- Ticket **137** (Right-side sheet panel UI contribution entrypoint `ui/right-sheet`) — todo

## Scope

1. **Register `right-sheet` contribution on builtin `notifications`:**
   - Update `packages/core/builtins/notifications/meta.json` with `"icon": "Bell"` (and `rightSheet` label/description metadata from ticket 137).
   - Add `packages/core/builtins/notifications/ui/right-sheet.tsx` using `@agentos/core/client` (`useHostApi`, `useHostUi`) and `@agentos/ui` primitives (`ScrollArea`, `Badge`, `Button`, `LoadingState`, `Tabs`/filter buttons).
2. **Fetch & render `/recent` entries:**
   - Fetch `GET /api/ext/notifications/recent` via `api.fetch('/recent')` (which returns `{ notifications: NotificationEntry[] }` sorted newest-first).
   - Display every entry with:
     - Severity icon and badge (`error`, `warning`, `success`, `info`) using `@phosphor-icons/react` and `@agentos/ui` tokens
     - Message text (and `subject` / `error` detail if present)
     - Relative/formatted timestamp (`at`)
     - Source extension badge when `extensionId` is present (added in ticket **139**; gracefully omitted if absent)
   - Support severity filtering (`All`, `Errors`, `Warnings`, `Info`, `Success`) and a manual Refresh button.
   - Auto-refresh when the sheet opens / becomes visible (and optional lightweight polling while open).
   - Handle loading (`LoadingState`), empty ("No notifications yet"), and API error states cleanly.
3. **Tests:**
   - Add unit tests for `packages/core/builtins/notifications/ui/right-sheet.tsx` (loading, empty, populated list with all severities, filtering, refresh, error state).
   - Update `packages/core/builtins/notifications/tests/scan-notifications-builtin.test.ts` to assert `ui['right-sheet']` / `uiEntries['right-sheet']` discovery.

## Out of scope

- Changing how extensions emit errors/warnings to `/notify` (covered by ticket **139**).
- Mark-as-read / unread badge persistence in db-store (can be a follow-up if needed).

## Done when

- [ ] Builtin `notifications` exposes `ui/right-sheet.tsx` and appears as a Bell trigger in the Shell TopBar
- [ ] Opening the right sheet fetches and renders all entries from `GET /api/ext/notifications/recent`
- [ ] Severity icons/badges, timestamps, filters, refresh, loading, empty, and error states are implemented with `@agentos/ui` primitives
- [ ] Unit tests cover `right-sheet.tsx` and scanner discovery for `notifications`
- [ ] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` → click the Bell icon in the TopBar → verify the right-side sheet opens over any page, loads entries from `/api/ext/notifications/recent`, filters by severity, and refreshes cleanly
