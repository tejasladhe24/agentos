# 128 — Role-scoped Activity Bar, per-user email sender, and Organization/Roles/Members tables

**Status:** in-progress

## Goal

Align secondary Activity Bar visibility, Email settings, and Organization settings with tenant-staff vs admin roles:

1. **Secondary Activity Bar & RBAC** — All authenticated tenant users can access **Approvals** (`hitl`), **Email** (`inbound-email`), **Files** (`files`), **Activity** (`audit`), and **Settings** (`settings`). **Secrets** (`secrets`) and **Extensions** (`extensions`) remain admin-only (`admin` / `owner`).
2. **Email Settings (per-user `from` + admin-only provider/keys)** — Non-admin users can configure their own per-user `from` address (used when sending under the org's Resend/Cloudflare API key) and do not see provider selection or API keys. Admins manage provider selection, API keys, and org-level email sending/receiving; Cloudflare `accountId` is auto-detected from the API token when omitted (with manual override still supported).
3. **Organization / Roles / Members Settings tables** — Replace the old Active organization list + Create organization form with an **Organizations** table (with admin-only Create organization action), a **Roles** table listing all roles available in the organization, and a **Members** table below Roles listing all members and their roles. For admins, add an unlabeled actions column with a three-dot menu (`DotsThreeIcon`) on each row for org actions (switch, rename, delete), role actions (edit permissions, delete), and member actions (change role, remove from org).

## Depends on

- Ticket **38** (Activity Bar primary/secondary) — done
- Ticket **75** (Auth SSO + role admin API) — done
- Ticket **101** (Extension-registered Settings) — done
- Ticket **105** (Email + SMS sending BYOK) — done

## Scope

1. **Shell Activity Bar & RBAC**
   - Store authenticated `sessionRoles` in `useShellStore` from `AuthGate`.
   - Hide admin-only secondary items (`secrets`, `extensions`) from non-admin users in `buildActivityBarSections` / `ActivityBar` and guard restored view/panel state if a non-admin loads a stored admin view/panel.
   - Update default seeded RBAC permissions in `packages/core/builtins/auth/api/lib/rbac-store.ts`: grant `audit.read` and `email.send` to `viewer` so all tenant staff can access Approvals, Email, Files, Activity, and Settings; restrict `secrets.read` / `secrets.write` to `admin` and `owner`.
2. **Notifications / Email Settings**
   - Add per-user email sender preferences (`GET /preferences/email`, `PUT /preferences/email`) in `packages/core/builtins/notifications/` backed by `db-store`, scoped to `(orgId, userId)`.
   - Extend `SendPayload` with optional `from?: string`; Resend and Cloudflare providers use `payload.from || config.from`. `POST /notify` resolves the authenticated user's personal `from` preference before falling back to the org/platform default.
   - Auto-pull Cloudflare `accountId` via `GET https://api.cloudflare.com/client/v4/accounts` when admin omits `accountId` during save/test; keep `accountId` editable as an optional manual override.
   - Update `packages/core/builtins/inbound-email/ui/settings.tsx`: show the personal "From address" card to all users; render org-level Email sending (`IntegrationSection`) and Email receiving (`ReceivingCard`) only for admins (`canManage`).
3. **Auth API & Organization / Roles / Members UI**
   - Gate `POST /orgs` to admins (`PERMISSION_ROLES_MANAGE`).
   - Add `PATCH /orgs/:id` (rename org), `DELETE /orgs/:id` (delete org), and `DELETE /roles/:role` (delete custom role; protect `admin`/`owner`) in `packages/core/builtins/auth/api/`.
   - Allow any authenticated member of the active org to read `GET /roles` and `GET /orgs/members` (write/delete endpoints remain admin-only).
   - Rebuild `AccountOrganizationSection` as an Organizations table with admin-only Create organization dialog and row three-dot actions menu (Switch, Rename, Delete); non-admins get a Switch action on inactive orgs.
   - Rebuild `AccountRolesSection` as a Roles table listing all org roles and their permissions, with admin-only Create role dialog and unlabeled 3rd actions column three-dot menu (Edit permissions, Delete role).
   - Add `AccountMembersSection` below Roles as a Members table listing all org members and their roles, with admin-only unlabeled 3rd actions column three-dot menu (Change role, Remove from organization).
   - Update `packages/core/builtins/auth/meta.json` settings search entries for `organizations`, `roles`, and `members`.

## Done when

- [x] Non-admin users see Approvals, Email, Files, Activity, Settings in secondary Activity Bar and cannot see Secrets or Extensions
- [x] Admin/owner users see all secondary items including Secrets and Extensions
- [x] Seeded RBAC grants `audit.read` + `email.send` to `viewer` and keeps `secrets.*` admin/owner-only
- [x] Per-user email `from` preference API + UI works for all users; `POST /notify` applies user `from` override
- [x] Non-admin users do not see email provider selection or API key settings
- [x] Cloudflare `accountId` auto-detects from API token when omitted
- [x] Auth API supports `PATCH /orgs/:id`, `DELETE /orgs/:id`, `DELETE /roles/:role`, admin-gated `POST /orgs`, and member-readable `GET /roles` + `GET /orgs/members`
- [x] Settings → Organization renders Organizations, Roles, and Members tables with admin-only Create actions and unlabeled three-dot row action menus
- [x] Unit & component tests cover all new behavior
- [x] `bun run ci` green

## Verify

- `bun test` across `packages/core`
- `bun run ci`
