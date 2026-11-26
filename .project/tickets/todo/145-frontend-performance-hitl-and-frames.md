# 145 — Shell and extension performance: HITL, frame mounting, theme, selectors

**Status:** todo

## Goal

Cut avoidable network traffic and iframe work found in the tech debt audit. Targets are the approval polling loop, eager iframe mounting, theme reloads, and per-render array allocation.

## Depends on

- Ticket **74** (`hitl.resolved` event) — done
- Ticket **142** (Extension UI event bus) — todo (for the theme and approval events below)
- Ticket **136** (Full-page Approvals; removed `HitlInbox` and `sidebarPanel`) — merged

## Findings

1. **HITL polling is heavy.** `createShellHostApi` → `requestHitlApproval` refetches the full `/api/ext/hitl/approvals` list every 250 ms for up to 5 minutes. The Approvals page (`packages/core/builtins/hitl/ui/lib/use-approvals.ts`) also polls every 3 s (`APPROVALS_POLL_MS`).
2. **Every frame mounts at boot.** `MainCanvas`, `SidebarSlot`, `SettingsView`, and `RightSidebarSlot` all render an `ExtensionFrame` for every enabled extension, so each one does a handshake and `onActivate` immediately.
3. **Theme change reloads frames.** `withThemeQuery(src, theme)` puts the theme in the iframe `src`, so toggling theme reloads and re-handshakes every frame.
4. **Unstable selector.** `useShellContributions` returns a new filtered array on every render, which defeats `useMemo` in `useSettingsItems` and `ShellRoot`.
5. **Storage is in-memory.** `storageByExtension` in `create-shell-host-api.ts` is a `Map`, so extension storage is lost on reload even though the SDK API looks persistent.
6. **Shell chrome re-renders.** `ShellRoot` subscribes to several store slices individually; the resize effects run on every `sidebarExpanded` change.

## Scope

1. **Approvals:**
   - `requestHitlApproval` waits on `hitl.resolved` from the bus (ticket 142) instead of polling. Fall back to a single `GET /approvals/:id` on a 5 s interval only if SSE is unavailable.
   - Add `GET /api/ext/hitl/approvals/:id` if it does not exist.
   - Replace the 3 s poll in `use-approvals.ts` with a refresh on `hitl.resolved` (keep a slow fallback poll only when events are unavailable).
2. **Lazy frames:**
   - Mount an `ExtensionFrame` the first time its contribution is visible; keep it mounted afterwards (preserves the no-remount behaviour from ticket 102).
   - Settings frames mount when their section is first selected.
3. **Theme without reload:**
   - Send the resolved theme to frames as a host event (`shell.theme.changed`) and apply the `dark` class inside the frame.
   - Keep `?theme=` only for the initial load.
4. **Selectors:**
   - `useShellContributions` memoizes filtered arrays with `useMemo` on `[contributions, view]`, or moves to a store selector with shallow equality.
5. **Storage:** back `host.storage` with `localStorage` keyed by org and extension, or document clearly that it is session-only and rename it.
6. **Tests:** update `extension-frame.test.tsx`, `main-canvas` tests, `create-shell-host-api.test.ts`; add a test that a hidden, never-visited frame does not mount.

## Out of scope

- Server-side caching changes.
- Replacing Comlink.

## Done when

- [ ] Approval waits no longer poll the list endpoint every 250 ms (verified by a test with fake timers)
- [ ] Approvals page refresh is event-driven (`hitl.resolved`), not a 3 s list poll
- [ ] A frame that has never been visible does not load its `src` on boot (measured in browser devtools: request count at first paint drops)
- [ ] Switching theme does not change any iframe `src`
- [ ] `useShellContributions` returns a stable reference for unchanged inputs (test)
- [ ] `host.storage` behaviour is either persistent or explicitly documented as session-only
- [ ] `bun run ci` passes

## Verify

- `bun run ci`
- Browser devtools Network tab: note request count on first load before and after; confirm no `/approvals` list requests during an idle approval wait
- Toggle theme with several extensions open: confirm no iframe reload in the Network tab
