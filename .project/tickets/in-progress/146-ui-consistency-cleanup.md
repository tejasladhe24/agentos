# 146 — UI and code consistency cleanup (tech debt)

**Status:** in-progress (partially done; see "As built")

## Goal

Remove the repeated patterns and layout drift found in the tech debt audit, so builtin and example extensions share one set of helpers and one folder layout. This is a behaviour-preserving cleanup.

## Depends on

- None hard. Sequence after tickets **143** and **144** so file moves do not conflict with the hook rewrites.

## Findings and scope

1. **JSON parsing helper.** About 30 call sites do `JSON.parse(res.body)` inside `try` / `catch`.
   - Add `api.json<T>(path, init)` (or `parseHostJson`) to `@agentos/core/client` that returns `{ ok, status, data, error }`.
   - Migrate builtins and examples.
2. **Settings page layout.** Five `settings.tsx` files repeat `fixed inset-0 overflow-y-auto bg-background px-6 py-6 text-foreground` (`files`, `auth`, `inbound-email`, `notifications`, `ai`).
   - Add `SettingsPage` to `@agentos/core/client/components` and use it in all five.
3. **Folder layout.** Per `agentos-ui.mdc` and `AGENTS.md`, modules use `ui/components/` and `ui/lib/`.
   - `files/ui` (18 files), `inbound-email/ui` (14), and `auth/ui` (10) are flat. Split them into `components/`, `lib/`, and `page`/`settings` entry files. `audit` and `secrets` are the reference layout.
4. **Oversized file.** `files/ui/files-browser.tsx` is 1,332 lines.
   - Split into `files-browser/` (toolbar, table, grid, empty state, selection bar) with no behaviour change.
5. **Native tables.** `files/ui/files-browser.tsx` uses two raw `<table>` elements (lines ~832 and ~910).
   - Replace with `@agentos/ui` `Table` components unless a specific accessibility reason is documented.
6. **Test data in production code.** `STUB_EXTENSION_CATALOG` and `STUB_SKILLS_BY_EXTENSION` (fake `crm` and `invoices`) live in `packages/core/src/shell/lib/chrome/extension-catalog.ts`.
   - Move them to `packages/core/src/shell/tests/fixtures/` and import from tests only. `defaultEnabledById` and `collectEnabledSkills` keep their `extensions` parameter.
7. **Plaintext recovery code on disk.** `tmp/twilio-recovery-code.txt` is git-ignored but holds a secret in plaintext.
   - Delete the file, confirm the code is stored in the vault, and add `tmp/` to the pre-commit secret check if one exists.
8. **Lint-style guard.** Add an eslint rule or a `bun` script that fails on new native `<button>`, `<input>`, `<select>`, `<table>` in `packages/core/builtins/*/ui` and `examples/*/extensions/*/ui` (exceptions documented).

## Out of scope

- Visual redesign. Pixel output should not change.
- Changing backend APIs.

## Done when

- [~] `parseHostJson` / `hostJson` / `useHostJson` exported from `@agentos/core/client`; `parseErrorBody` deduplicated. Migrated: inbound-email inbox/deliveries/addresses. **Not** every site migrated (see As built)
- [x] `SettingsPage` is used by all five settings pages
- [x] `files`, `inbound-email`, and `auth` UI follow the `components/` + `lib/` layout; no flat UI folders over 8 files (guarded by test)
- [~] `files-browser.tsx` is split. **Not met:** three auth files still exceed 500 lines (allowlisted in the guard test)
- [x] No native `<table>` in builtin UI
- [x] Stub catalog and skills fixtures live under `tests/`
- [ ] `tmp/twilio-recovery-code.txt` is removed after confirming the secret is in the vault — **NOT DONE** (needs a human to confirm the vault copy)
- [x] A guard test blocks new native controls in extension UI
- [x] `bun run ci` passes

## Verify

- `bun run ci`
- Visual spot-check in `agentos dev`: Files, Email, Settings pages look unchanged

## As built

- `SettingsPage` (`client/components/settings-page.tsx`) is the shared frame for the notifications, ai, inbound-email, auth and files settings pages.
- Stub catalog moved to `shell/tests/fixtures/stub-extension-catalog.ts`. `defaultEnabledById` and `collectEnabledSkills` now require an `extensions` argument.
- `files`, `inbound-email` and `auth` UI use `components/` + `lib/`; `page`, `settings`, `sidebar` and `right-sidebar` entry files stay in `ui/`.
- `files-browser` is a folder (`files-browser/`) of focused files. The two raw tables became `@agentos/ui` `Table`. `Table` gained an optional `containerClassName` (the files lists pass `overflow-visible` so the sticky header keeps working inside `ScrollArea`). `storage-backends`, `add-storage-dialog` and `page` were split too.
- `client/lib/host-json.ts`: `parseErrorBody`, `parseHostJson` (never throws; a 2xx with an unparsable body becomes `{ ok: false, error: "Invalid response" }`), `hostJson`, `useHostJson`. The four duplicate `parseErrorBody` copies were replaced.
- Guard: `client/tests/extension-ui-conventions.test.ts` fails on native `button`, `input`, `select`, `textarea` or `table` in builtin and example extension UI unless an `agentos-allow-native:` comment explains why (only the hidden file input in `files-upload-zone.tsx`). It also guards file size (500 lines), flat folders (8 files), `SettingsPage` use and `STUB_` symbols outside tests.

### Not done (deliberate)

- `auth/ui/components/account-members-section.tsx` (896 lines), `account-roles-section.tsx` (746) and `account-organization-section.tsx` (688) are still over 500 lines. They are allowlisted in the guard; remove an entry when the file is split.
- `JSON.parse(res.body)` remains in bespoke parsers (audit, ai settings, files blob handling, `invoice-bot` and `crm-helper` example pages that map status codes to custom messages). Migrate opportunistically with `parseHostJson`.
- `tmp/twilio-recovery-code.txt` was not deleted or read. It is git-ignored; delete it by hand after confirming the code is in the vault.
- No live UI QA was run (Files list/storage Table styling, dialogs, settings pages).
