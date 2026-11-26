# 146 — UI and code consistency cleanup (tech debt)

**Status:** todo

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

- [ ] `api.json` (or equivalent) is exported from `@agentos/core/client` and used at every former `JSON.parse(res.body)` site in UI code
- [ ] `SettingsPage` is used by all five settings pages
- [ ] `files`, `inbound-email`, and `auth` UI follow the `components/` + `lib/` layout; no flat UI folders over 8 files
- [ ] `files-browser.tsx` is split; no file in `ui/` exceeds 500 lines
- [ ] No native `<table>` in builtin UI
- [ ] Stub catalog and skills fixtures live under `tests/`
- [ ] `tmp/twilio-recovery-code.txt` is removed after confirming the secret is in the vault
- [ ] A lint or script guard blocks new native controls in extension UI
- [ ] `bun run ci` passes

## Verify

- `bun run ci`
- Visual spot-check in `agentos dev`: Files, Email, Settings pages look unchanged
