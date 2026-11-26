# 144 — Remove direct cross-extension calls from extension UIs

**Status:** in-progress

## Goal

Extension UIs must not call other extensions' routes. Today `inbound-email` calls `notifications`, `auth`, and `files` by absolute `/api/ext/<other>/…` path through `api.fetch`, and `createShellHostApi` lets any extension reach any builtin route. Each cross-extension need becomes either a bus event (ticket **142**) or a declared host capability.

## Depends on

- Ticket **142** (Extension UI event bus) — merged

## Current call sites

- `packages/core/builtins/inbound-email/ui/compose-section.tsx`: `POST /api/ext/notifications/notify`
- `packages/core/builtins/inbound-email/ui/page.tsx`: `POST /api/ext/auth/permissions/check`
- `packages/core/builtins/inbound-email/ui/user-email-from-card.tsx`: `/api/ext/notifications/preferences/email`
- `packages/core/builtins/inbound-email/ui/settings.tsx`: `/api/ext/notifications/integrations/email.send`
- `packages/core/builtins/inbound-email/ui/deliveries-section.tsx`: `/api/ext/notifications/deliveries…`
- `packages/core/builtins/inbound-email/ui/email-types.ts`: `/api/ext/files/blobs/…`
- `packages/core/builtins/notifications/ui/*` and `auth/ui/settings.tsx` for the same pattern (review and list in this ticket)
- `packages/core/src/shell/lib/chrome/create-shell-host-api.ts`: the `api.fetch` absolute-path branch

## As built

- Host capabilities: `auth.can`, `files.blobUrl`, `notifications.send`, `notifications.getEmailPreferences` / `setEmailPreferences`. Preferences are flat methods on `notifications` (not a nested `notifications.preferences` namespace) because Comlink only keeps top-level namespaces live; nested plain objects are structured-cloned and lose their functions.
- Deliveries, the `email.send` integration form, and receiving config have no dedicated capability. They use the declared-dependency path: `meta.json` `dependsOn: ["notifications"]` plus the client `extensionPath()` helper, so no UI hardcodes an `/api/ext/<other>/` literal.
- `api.fetch` enforcement returns `{ ok: false, status: 403 }` for undeclared targets (no network call).
- `auth.can` fails closed to `false` on 401 and rejects when auth is unreachable; the Email page treats a rejection as "keep Compose visible, the API still enforces" (unchanged behaviour). The old explicit "Sign in to use Email." message was dropped; the Shell only mounts extension frames for signed-in sessions.
- No bus event was needed for the call sites in this ticket (none reacted to another extension), so nothing was added to `meta.json` `events` here.
- A guard test (`extension-ui-gateway-paths.test.ts`) fails the build if a builtin UI hardcodes another extension's gateway path without declaring it.

## Scope

1. **Host capabilities for shared platform needs:**
   - `host.auth.can(permission): Promise<boolean>` (wraps `auth/permissions/check`, reads `sessionRoles` from the Shell store, caches per session). Replaces the permission check in `inbound-email/ui/page.tsx`.
   - `host.notifications.send({ channel, message, … })` and `host.notifications.preferences` replace direct notifications calls.
   - `host.files.blobUrl(key)` replaces the hardcoded `files` blob path.
2. **Bus-based cross-extension flows:** where one extension reacts to another, use a declared event (for example `notifications.delivery.updated`) instead of a poll or a direct fetch.
3. **Restrict `api.fetch`:**
   - Absolute `/api/ext/<id>/…` paths are allowed only when `<id>` is the caller's own extension or is listed in the caller's `meta.json` `dependsOn`.
   - Otherwise the Shell rejects the call with `403`.
4. **Cleanup:** remove the hardcoded `/api/ext/notifications/...` and `/api/ext/auth/...` strings from extension UI code; `EMAIL_SEND_INTEGRATION_PATH` etc. move behind the new capabilities.
5. **Tests:** `create-shell-host-api.test.ts` covers the allowlist; `inbound-email` tests use stub capabilities instead of raw paths.

## Out of scope

- Removing the Shell's own `notifications` and `hitl` calls in `create-shell-host-api.ts`. Those become capability calls in a follow-up if needed.
- Changing backend routes.

## Done when

- [x] `rg "/api/ext/(notifications|auth|files)" packages/core/builtins/*/ui` returns no matches outside the owning extension
- [x] `host.auth.can`, `host.notifications` (send + email preferences), and `host.files.blobUrl` exist in the SDK and client
- [x] `api.fetch` enforces the own-extension / `dependsOn` allowlist, with tests
- [x] `meta.json` `dependsOn` is documented in `.project/docs/extensions.md`
- [x] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` → Email: compose, deliveries, and address settings still work for an admin and a non-admin

## Notes

The `inbound-email` page currently fetches permissions before it renders. Moving it to `host.auth.can` also removes one network round trip per page open.
