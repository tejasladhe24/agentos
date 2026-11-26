# 136 — Full-page views for Approvals and Extensions Manager

**Status:** in-progress

## Goal

Promote **Approvals (HITL)** and **Extensions Manager** from left-sidebar-only panels (`sidebarPanel: 'hitl' | 'extensions'`) into proper URL-addressable full pages so they no longer open awkwardly on top of unrelated workspace pages. Remove the `sidebarPanel` overlay mechanism once both panels are migrated.

## Depends on

- Ticket **128** (Role-scoped Activity Bar — admin-only `extensions`) — done
- Ticket **135** (Shell routing with TanStack Router) — in progress

## Scope

1. **Extensions Manager page (`/extensions`):**
   - Promote `ExtensionManagerList` into a Shell-hosted page (`ExtensionManagerView`, rendered in `MainWorkspace` inside `KeepAlive` when `activeView === 'extensions'`, parallel to `SettingsView`).
   - Add `/extensions` to `viewToPath` / `pathToView` (`packages/core/src/shell/lib/routing/view-paths.ts`), `isKnownAppPath`, and `createAppRouter` (`packages/core/src/shell/components/routing/app-router.tsx`).
   - Keep admin-only gating (`isAdminRoles`): non-admin visits to `/extensions` redirect to `/` (or `activeView = 'home'`), and the secondary Activity Bar item remains admin-only.
   - Give the page a clean full-width layout (header, search + builtin filter toolbar, extension cards/table using `@agentos/ui` primitives) instead of a narrow sidebar list.
2. **Approvals page (`/ext/hitl`):**
   - Add `packages/core/builtins/hitl/ui/page.tsx` and update `packages/core/builtins/hitl/meta.json` (`"name": "Approvals"`, `"icon": "HandWaving"`, `"activityBarSection": "secondary"`), so Approvals works like every other builtin page (`files`, `audit`, `secrets`, `email`) at `/ext/hitl`.
   - Use `@agentos/core/client` (`useHostApi`, `useHostNotifications`) and `@agentos/ui` primitives (`Tabs`, `Table`/`Card`, `Badge`, `Button`, `LoadingState`, `ScrollArea`).
   - Support status filter tabs (`pending`, `approved`, `rejected`, `all`) backed by `GET /api/ext/hitl/approvals` (which already supports optional `?status=`), display full body/metadata/timestamps, and provide Approve/Reject actions (`POST /api/ext/hitl/approvals/:id/resolve`).
   - Update `createShellHostApi` (`hitl.requestApproval`) so creating an approval notifies the user and/or navigates to `/ext/hitl` instead of calling `setSidebarPanel('hitl')`.
   - Remove Shell's in-process `HitlInbox` component (`packages/core/src/shell/components/chrome/hitl-inbox.tsx`) and `BUILTIN_ACTIVITY_CHROME` entry for `hitl`.
3. **Remove `sidebarPanel` overlay mechanism:**
   - Remove `SidebarPanel`, `sidebarPanel`, `setSidebarPanel`, and `useShellSidebarPanel` (and `panel` from `ActivityBarItem` / `StoredActivitySelection`, keeping backwards-compatible read of old localStorage entries).
   - Simplify `SidebarSlot` and `sidebarColumnHasContent` so the left sidebar only hosts active-view context (`dashboardSidebar`, `SettingsSidebar`, or active extension `ui/sidebar.tsx`).
4. **Docs & tests:**
   - Update `.project/docs/architecture.md` (SPA route table + left sidebar description).
   - Add unit tests for `packages/core/builtins/hitl/ui/page.tsx`, `/extensions` routing + admin guard, `ExtensionManagerView`, and updated `ActivityBar`, `SidebarSlot`, `sidebarColumnHasContent`, `createShellHostApi`, and `activity-bar-persistence` tests.

## Out of scope

- Building an extension marketplace or remote install flow in Extension Manager.
- Adding approval assignment / multi-step workflows to `hitl` backend.

## Done when

- [ ] Clicking **Extensions** in the secondary Activity Bar navigates to `/extensions` and renders the full-page Extensions Manager (admin-only; non-admins cannot access `/extensions`)
- [ ] Clicking **Approvals** in the secondary Activity Bar navigates to `/ext/hitl` and renders `packages/core/builtins/hitl/ui/page.tsx` with status filters (`pending` / `approved` / `rejected` / `all`) and Approve/Reject actions
- [ ] Neither Approvals nor Extensions opens as a left-sidebar overlay over other pages (covered by activity-bar / sidebar-slot tests; live check pending)
- [x] `sidebarPanel` / `setSidebarPanel` / `HitlInbox` are removed cleanly; `SidebarSlot` only renders active-view sidebars
- [x] `hitl.requestApproval` no longer depends on `sidebarPanel`
- [x] Unit tests cover the new pages, routing, admin gating, and simplified sidebar/activity bar
- [x] `bun run ci` passes

## Verify

- `bun run ci`
- Local `agentos dev` → click **Extensions** and **Approvals** in the secondary Activity Bar → confirm URLs update to `/extensions` and `/ext/hitl`, full pages render cleanly without overlaying other views, browser back/forward and refresh work, and Approvals can filter by status and approve/reject pending requests
