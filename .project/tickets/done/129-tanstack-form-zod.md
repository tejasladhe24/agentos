# 129 — Standardize forms on TanStack Form + Zod

**Status:** done

## Goal

Replace ad-hoc `useState` + manual submit handlers across Shell and builtin UI forms with `@tanstack/react-form` and `zod` schema validation, rendering consistent per-field errors (`aria-invalid`, `data-invalid`, `FieldError`) and form-level submit errors.

## Depends on

- `@agentos/ui/components/field` (`Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`) — already present
- `zod` (`^4.6.7`, Standard Schema compatible) — already installed in `@agentos/core`

## Done when

- [x] `@tanstack/react-form` installed in `@agentos/core` with a shared error-mapping helper (`fieldErrorsToUi` / form helpers) for `@agentos/ui/components/field`
- [x] Shell auth pages migrated (`login-page.tsx`, `register-page.tsx`, `forgot-password-page.tsx`, `reset-password-page.tsx`)
- [x] Auth builtin settings migrated (`account-profile-section.tsx`, `account-security-section.tsx`, `account-organization-section.tsx`, `account-members-section.tsx`, `account-roles-section.tsx`) — including moving dialog errors inside their dialogs
- [x] Secrets builtin dialog migrated (`secret-create-dialog.tsx`) with Zod validation for key, value, and optional ISO `expiresAt`
- [x] Inbound email builtin forms migrated (`compose-section.tsx`, `addresses-section.tsx`, `user-email-from-card.tsx`, `receiving-card.tsx`)
- [x] Shared integration settings form migrated (`integration-section.tsx`, `integration-card.tsx`, `ai-model-field.tsx`) with dynamic Zod schema derived from `IntegrationProviderSpec`
- [x] Files builtin dialog forms migrated (`add-storage-dialog.tsx`, `storage-backends.tsx`, `files-browser.tsx` rename/move/copy) wrapped in `<form>` with Zod validation
- [x] Tests cover Zod validation, per-field errors, and form submission behavior
- [x] `bun run ci` passes

## Notes

- Search/filter bars (`activity-filters.tsx`, `not-found-page.tsx`, `files-browser.tsx` toolbar search, `crm-helper/ui/sidebar.tsx`), chat composer (`chat-panel.tsx`), and instant-save / read-only controls are intentionally left as-is.
- Zod v4 implements Standard Schema natively, so TanStack Form v1 accepts Zod schemas directly in `validators: { onSubmit: schema }` without an extra adapter package.

## Verify

- `bun test`
- `bun run ci`
