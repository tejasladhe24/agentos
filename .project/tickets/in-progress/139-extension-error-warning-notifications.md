# 139 — Extension error & warning reporting to Notifications API (`/recent`)

**Status:** in-progress

## Goal

Finish and verify the half-wired notifications pipeline so all extension operational errors and warnings are consistently registered through the `notifications` extension API and appear in `GET /api/ext/notifications/recent` with accurate severity (`error` / `warning`) and source attribution.

## Depends on

- Ticket **61** (Durable notifications state) — done
- Ticket **82** (SDK parity: notifications) — done
- Pairs with Ticket **138** (Notifications right-sheet UI)

## Current gaps found

- `createShellHostApi` already fans out `host.notifications.show(message, type)` to `POST /api/ext/notifications/notify`, **but**:
  1. `NotificationType` only supports `'info' | 'success' | 'error'` — `'warning'` is missing across `@agentos/core/sdk`, `@agentos/core/api/notifications`, and `packages/core/builtins/notifications/api` (`routes.ts` coerces `'warning'` to `'info'` and `db-store-client.ts` `parseEntry` drops unknown types), even though `@agentos/ui/components/toast` already has a `WarningIcon`.
  2. `fanOutNotification` does not send `extensionId`, and `POST /notify` / `NotificationEntry` do not persist which extension emitted the notification.
  3. Most builtin UIs (`auth`, `secrets`, `inbound-email`, `audit`, `notifications`, `files` mounts/dialogs, and shared `IntegrationSection`) call `notifications.show(..., 'info')` for successes, while failures only call local `setError(...)` and never report to `notifications.show(..., 'error' | 'warning')`. Sample extensions (`crm-helper`, `invoice-bot`) do not use `useHostNotifications()` at all.
  4. Tests do not verify the fan-out payload (`type`, `extensionId`) or end-to-end `/notify` → `/recent` persistence for errors and warnings.

## Scope

1. **Add `'warning'` severity across SDK, API kit, Shell, and Notifications builtin:**
   - Extend `NotificationType` to `'info' | 'success' | 'warning' | 'error'` in:
     - `packages/core/src/sdk/lib/types.ts`
     - `packages/core/src/api/lib/notifications.ts`
     - `packages/core/builtins/notifications/api/lib/db-store-client.ts` (`parseEntry`)
     - `packages/core/builtins/notifications/api/lib/routes.ts` (`handleNotify`)
     - Shell `StatusBar` tone styling (handle `'warning'`).
2. **Persist source extension attribution (`extensionId`):**
   - Accept optional `extensionId?: string` in `POST /api/ext/notifications/notify` (`handleNotify`, `EnqueueInput`, `NotificationEntry`, `parseEntry`, and `@agentos/core/api/notifications` `NotifyInput`).
   - Pass `extensionId` from `createShellHostApi(extensionId)` in `fanOutNotification`.
3. **Wire extensions & builtins to report operational errors and warnings:**
   - Update builtin UIs (`files`, `auth`, `secrets`, `inbound-email`, `audit`, `notifications`, `hitl`, and shared `packages/core/src/client/components/integration-section.tsx`) so API/operational errors and warnings call `useHostNotifications().show(message, 'error' | 'warning')` (keep field-level form validation inline).
   - Update sample extensions (`examples/client-app/extensions/crm-helper`, `examples/client-app/extensions/invoice-bot`) to report operational errors/warnings via `useHostNotifications()`.
   - Where server-side extension APIs encounter noteworthy operational warnings/errors that should surface to users (e.g. background/async failures), document/use `@agentos/core/api/notifications` `notify({ channel: 'in_app', type: 'error' | 'warning', extensionId, message })`.
4. **Tests:**
   - Add tests in `packages/core/builtins/notifications/tests/notifications-server.test.ts` verifying `type: 'warning'` and `extensionId` round-trip through `POST /notify` → `GET /recent`.
   - Strengthen `packages/core/src/shell/tests/create-shell-host-api.test.ts` to assert `fanOutNotification` sends `{ message, type, extensionId }` including `'error'` and `'warning'`.
   - Update `packages/core/src/api/tests/domains.test.ts` for `'warning'` and `extensionId`.
   - Add/update UI tests confirming key extension error/warning paths invoke `notifications.show(..., 'error' | 'warning')`.

## Out of scope

- Reporting inline form validation errors (e.g. "Email is required") to the global notifications inbox.
- Sending email or SMS alerts for in-app extension errors.

## Done when

- [ ] `NotificationType` includes `'warning'` across SDK, API kit, Shell (`Toast` + `StatusBar`), and `notifications` builtin (no silent downgrade to `'info'`)
- [ ] `extensionId` is forwarded by `createShellHostApi` and persisted/returned by `POST /notify` and `GET /recent`
- [ ] Builtin UIs (`files`, `auth`, `secrets`, `inbound-email`, `audit`, `notifications`, `hitl`, `IntegrationSection`) and sample extensions (`crm-helper`, `invoice-bot`) report operational errors and warnings via `useHostNotifications()`
- [ ] Unit tests cover `'warning'` + `extensionId` persistence, `createShellHostApi` fan-out payloads, API kit types, and extension error/warning reporting
- [ ] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` → trigger an operational error or warning in an extension (e.g. failed API call or misconfigured integration) → verify toast appears AND the entry shows up in `GET /api/ext/notifications/recent` (and in the Notifications right sheet once ticket **138** is implemented) with the right `type` (`error` / `warning`) and `extensionId`
