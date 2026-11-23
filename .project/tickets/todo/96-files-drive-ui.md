# 96 — Files Drive-style UI (fully functional)

**Status:** todo

## Goal

Ship a **fully functional Google Drive–style Files manager** for builtin `files`: browse, upload, download, preview, rename/move, delete, and search — org-scoped, Activity Bar secondary, `@agentos/ui` only.

Today `files` is API-only (`PUT`/`GET`/`DELETE /blobs/:key`) with **no list/metadata/folder APIs** and **no `ui/`**. This ticket owns both the missing catalog APIs and the UI.

## Depends on

- Ticket **19** / **57** (files builtin + S3-compatible backend) — done
- Ticket **71** (org tenancy) — done
- Ticket **38** / **39** (Activity Bar secondary + sidebar patterns) — done
- Ticket **82** (`@agentos/core/api/files`) — done; extend for new routes

## Functional requirements

1. **Activity Bar entry** — Builtin `files` registers `activityBarSection: "secondary"` + icon; opens `ui/page.tsx` (main) and optional `ui/sidebar.tsx` (folder tree / filters).
2. **Browse** — List objects for the active org as a Drive-like grid **and** list view (toggle). Support folder prefixes (virtual folders via key prefix `/`).
3. **Navigate** — Breadcrumbs for current prefix; open folder; up/root navigation; empty-folder state.
4. **Upload** — Multi-file upload (drag-drop + file picker). Progress per file; failures isolated. Store under current prefix with safe key names.
5. **Download** — Download selected file(s) via existing blob GET.
6. **Preview** — In-panel preview for images + PDF; other types show metadata + download CTA.
7. **Select** — Single + multi-select; Select all in current folder; clear selection.
8. **Rename / move** — Rename file or folder prefix; move selected items to another prefix (copy+delete or dedicated move API).
9. **Delete** — Delete file or recursive folder-prefix delete with confirm dialog; toast on success/failure.
10. **Search** — Filter by name within current org (prefix or full catalog search); clear query restores browse.
11. **Metadata** — Each item shows name, size, content-type (when known), updated time; detail pane for selected item.
12. **Org scope** — All list/mutate ops use active session `orgId`; no cross-org leakage; unsigned-in redirects to auth gate.
13. **API gaps (required for UI)** — Extend builtin `files` + TS/Python clients:
    - `GET /blobs` (or `/objects`) — list by `prefix`, `cursor`/`limit`, return `{ key, bytes?, contentType?, updatedAt? }[]`
    - Metadata on PUT/GET (content-type, size, updatedAt) persisted (db-store index and/or backend head)
    - Optional `POST /blobs/move` or `POST /blobs/copy` for rename/move without client round-trips
    - Org key namespacing convention documented (`orgs/<orgId>/…` or equivalent) and enforced for session callers
14. **Permissions** — Session-authenticated UI; document any RBAC permission keys if introduced (`files.read` / `files.write`).
15. **Cmd+K** — Optional commands: “Upload files”, “Open Files” (nice-to-have; not blocking if palette patterns already cover view open).

## Non-functional requirements

1. **UI kit** — All controls from `@agentos/ui`; Phosphor icons; kebab-case files under `builtins/files/ui/`.
2. **Performance** — First folder paint with ≤100 items without blocking Shell; list pagination/cursor for large prefixes; upload of multi‑MB files must not freeze UI (chunked or background fetch).
3. **Limits** — Enforce and surface max object size / count consistent with AI attachment and platform limits; clear error when exceeded.
4. **A11y** — Keyboard nav for list/grid, focus management in dialogs, `aria-label`s on icon buttons, announced upload status.
5. **Responsive** — Usable at Shell sidebar+main widths and down to ~360px main pane (stack detail under list).
6. **Security** — No raw customer `DATABASE_URL`; blobs only via `/api/ext/files`; never log blob bodies; path traversal rejected on keys/prefixes.
7. **Backends** — Works with local FS **and** S3-compatible (`AGENT_OS_EXT_FILES_S3_*`); list API must be implemented for both.
8. **Tests** — API list/move/metadata round-trips; UI render tests for empty / loaded / error / uploading states; scan test for `ui/` + `meta.json` Activity Bar.
9. **Docs** — `builtins.md` Files section: UI + new routes; cookbook note Drive-style manager vs raw blob API.

## Done when

- [ ] `meta.json` Activity Bar secondary + `ui/page.tsx` (+ sidebar/components as needed)
- [ ] List / metadata / move(or rename) APIs shipped + `@agentos/core/api/files` (+ Python parity if trivial)
- [ ] Browse, upload, download, preview, rename/move, delete, search all work against real builtin in `agentos dev`
- [ ] Org isolation verified; FS + S3 paths covered by tests or documented manual check
- [ ] Docs + tests updated

## Notes

- Prefer **prefix-as-folder** over a separate folder table for v1.
- Do not build sharing links / public Drive ACLs in this ticket.
- Do not put Files UI into Shell chrome; keep it extension iframe like Auth/Settings.

## Verify

- `agentos dev` → Activity Bar Files → upload, folder nav, preview, rename, delete
- `bun test` files builtin + UI tests touched
- `bun run ci` before PR
