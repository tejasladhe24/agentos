# 143 — Replace `BroadcastChannel` hooks with bus-backed shared state

**Status:** todo

## Goal

Remove raw `BroadcastChannel` usage from extension UIs. Shared UI state (Files selection, prefix, section, mounts, detail-open; Email section; Auth account section) moves to the event bus from ticket **142**, with values persisted through host storage.

## Depends on

- Ticket **142** (Extension UI event bus) — todo
- Ticket **134** (Right sidebar + Files migration) — done (introduced most of these channels)

## Current state (to replace)

| File                                                           | Channel                        |
| -------------------------------------------------------------- | ------------------------------ |
| `packages/core/builtins/files/ui/use-files-selection.ts`       | `FILES_SELECTION_CHANNEL`      |
| `packages/core/builtins/files/ui/use-files-prefix.ts`          | `FILES_PREFIX_CHANNEL`         |
| `packages/core/builtins/files/ui/use-files-section.ts`         | `FILES_SECTION_CHANNEL`        |
| `packages/core/builtins/files/ui/use-files-mount.ts`           | `FILES_MOUNT_CHANNEL`          |
| `packages/core/builtins/files/ui/use-files-mounts.ts`          | `FILES_MOUNTS_CHANGED_CHANNEL` |
| `packages/core/builtins/files/ui/right-sidebar.tsx`            | `FILES_DETAIL_OPEN_CHANNEL`    |
| `packages/core/builtins/files/ui/page.tsx`                     | two channels                   |
| `packages/core/builtins/inbound-email/ui/use-email-section.ts` | `EMAIL_SECTION_CHANNEL`        |
| `packages/core/builtins/auth/ui/account-section.ts`            | `ACCOUNT_SECTION_CHANNEL`      |

Channel names are defined in `files-types.ts`, `email-section.ts`, and `account-section.ts`.

## Scope

1. **Shared-state hook:** add `useHostSharedState<T>(key, initial)` to `@agentos/core/client`. It reads and writes host storage and publishes `shared-state.changed` with the key on the bus; subscribers update on change.
2. **Migrate each hook** in the table to `useHostSharedState` with topics under the owning extension's namespace (for example `files.selection.changed`), declared in `meta.json`.
3. **Remove** every `new BroadcastChannel(...)` and the `*_CHANNEL` constants.
4. **Keep behaviour identical:** Files selection still syncs between `page.tsx` and `right-sidebar.tsx`; the right-sidebar open state still syncs.
5. **Tests:** update `files` and `inbound-email` tests; add a test asserting no `BroadcastChannel` references remain under `packages/core/builtins/*/ui`.

## Out of scope

- Changing what Files stores (only how it is shared).
- Cross-device sync.

## Done when

- [ ] `rg "BroadcastChannel" packages/core/builtins examples` returns no matches
- [ ] `useHostSharedState` is exported from `@agentos/core/client` and documented
- [ ] Files selection, prefix, section, mounts, and detail-open state sync across frames as before
- [ ] Email section and Account section sync via the bus
- [ ] A guard test fails the build if `BroadcastChannel` reappears in extension UI
- [ ] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` → Files: select a file on the page, confirm the right sidebar updates; toggle the right sidebar from the TopBar and confirm the page reflects it
