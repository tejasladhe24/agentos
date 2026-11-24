# 97 — Audit Activity manager UI (fully functional)

**Status:** done

## Goal

Ship a **fully functional Activity manager** on builtin **`audit`**: searchable, filterable, paginated “who did what” timeline for operators — not the `events` outbox.

Today audit is API-only (`POST`/`GET /entries`, limit ≤200) with **no `ui/`**, weak filtering, and no export. This ticket owns Activity UI + any list/query API upgrades needed.

## Depends on

- Ticket **19** / **82** (audit builtin + SDK) — done
- Ticket **87** (subject deletion writes audit entries) — done
- Ticket **38** / **39** (Activity Bar secondary) — done
- Orthogonal to **`events`** (pub-sub / queue) — do **not** merge UIs

## Functional requirements

1. **Activity Bar entry** — Builtin `audit` registers `activityBarSection: "secondary"` + icon (e.g. activity / list); opens `ui/page.tsx` labeled **Activity** (not “Audit” in the chrome title if product copy prefers Activity).
2. **Timeline / table** — Chronological list of entries (`at` desc) with columns/fields: time, action, actor, resource, meta summary.
3. **Detail** — Selecting a row opens a detail pane/drawer with full `meta` JSON (read-only, formatted).
4. **Filter** — Filter by `action` (exact/prefix), `actor`, `resource`, and date range (`from` / `to`). Clearing filters restores default recent feed.
5. **Search** — Free-text search across action / actor / resource / meta string fields.
6. **Pagination** — Cursor or offset pagination beyond today’s hard `limit` of 200; infinite scroll **or** page controls — pick one and document.
7. **Refresh** — Manual refresh; optional auto-refresh interval (off by default).
8. **Empty / error** — Clear empty state when no entries; error state when db-store unavailable (502).
9. **Export** — Download current filtered result set as JSON (and CSV if straightforward); respect max export cap.
10. **API gaps (required for UI)** — Extend `GET /entries`:
    - Query: `action`, `actor`, `resource`, `q`, `from`, `to`, `limit`, `cursor` (or `offset`)
    - Response: `{ entries, nextCursor? }` with stable ordering by `at` desc
    - Keep `POST /entries` unchanged for appenders
    - Update `@agentos/core/api/audit` + Python `agentos.audit`
11. **Write path from UI (optional)** — No general “create fake audit” in product UI; append remains for services / subject-delete. If a debug “emit test entry” is added, gate it to non-production.
12. **Org / tenancy** — Document whether `audit_entries` stays platform-scoped or becomes org-filterable for the viewer; **session callers must only see entries for their org** if entries are stamped with `orgId`/`meta.orgId`. If today platform-global, add org stamping + filter as part of this ticket so the Activity UI is tenant-safe.
13. **Deep link** — Support query or HostAPI open with optional `action` filter (e.g. from subject-delete success).

## Non-functional requirements

1. **UI kit** — `@agentos/ui` only; kebab-case under `builtins/audit/ui/`.
2. **Performance** — Initial load ≤50–100 rows; filters server-side (do not download entire collection to the browser).
3. **Immutability** — UI never edits/deletes audit rows (append-only preserved).
4. **A11y** — Table/list keyboard navigation; detail pane focus trap if dialog/sheet.
5. **Security** — No plaintext secrets in rendered `meta`; redact known secret-shaped keys in the UI if present; RBAC permission e.g. `audit.read` for session list (introduce if missing).
6. **Tests** — Filter/pagination API tests; UI states empty/loaded/filtered/error; Activity Bar scan.
7. **Docs** — `builtins.md`: Activity UI vs `events`; clarify audit ≠ outbox.

## Done when

- [x] Activity Bar secondary opens Activity manager UI
- [x] Filter, search, pagination, detail, export work end-to-end
- [x] Tenant-safe listing (org filter/stamp) documented and enforced for session callers
- [x] SDK + docs + tests updated

## Notes

- Product name in Shell: **Activity**. Builtin id stays `audit`.
- Do **not** show events outbox / claim / dead-letter here — that stays headless (or a future ops ticket).

## Verify

- `agentos dev` → Activity → see subject.delete / other entries; filter by action; open detail; export
- Trigger a subject delete → new row appears after refresh
- `bun test` audit builtin + UI; `bun run ci` before PR
