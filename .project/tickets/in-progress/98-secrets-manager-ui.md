# 98 — Secrets manager UI (fully functional)

**Status:** in-progress

## Goal

Ship a **fully functional Secrets manager** for builtin `secrets`: list keys for the active org, create/update/rotate, delete, and inspect metadata — without ever dumping plaintext into logs or casual UI copy.

Today secrets is API-only (`GET`/`PUT`/`DELETE /secrets/:key`, env fallback) with **no list endpoint** and **no `ui/`**.

## Depends on

- Ticket **77** / **82** (per-tenant vault + SDK) — done
- Ticket **71** (org tenancy) — done
- Ticket **50** (Auth account patterns; reuse section layout idioms) — done
- Ticket **38** / **39** (Activity Bar secondary) — done

## Functional requirements

1. **Activity Bar entry** — Builtin `secrets` registers `activityBarSection: "secondary"` + icon (e.g. key / lock); opens `ui/page.tsx` titled **Secrets**.
2. **List keys** — Table of vault keys for active org: key name, `updatedAt`, `expiresAt` (if set), source badge (`vault` vs note that env fallback keys are not listed unless explicitly supported).
3. **Create** — Dialog/form: key name (validated), value (password-style input), optional `expiresAt`; `PUT` via API; success toast; list refresh.
4. **Reveal / copy** — Reveal value only on explicit user action (hold/toggle) with short timeout re-mask; Copy to clipboard; never show value in the list row by default.
5. **Rotate / update** — Edit value for existing key (same `PUT`); confirm when overwriting.
6. **Delete** — Confirm dialog; `DELETE`; remove from list.
7. **Search / filter** — Filter keys by name prefix; empty state when none.
8. **Permissions** — Enforce `secrets.read` / `secrets.write`; hide mutate actions without write; 403 → clear UI message.
9. **Master key health** — Surface health (`GET /health` → `masterKey` / vault status): if master key missing, disable create/update with actionable copy (env `AGENT_OS_EXT_SECRETS_MASTER_KEY`).
10. **API gaps (required for UI)** — Extend builtin:
    - `GET /secrets` — list metadata only: `{ keys: [{ key, updatedAt?, expiresAt?, hasValue: true }] }` — **never** return plaintext values in list
    - Keep `GET /secrets/:key` for reveal (already returns value)
    - Optional: do not list env-fallback-only keys in v1 (document)
    - Update `@agentos/core/api/secrets` + Python parity
11. **Org scope** — Always active `orgId` from session; no cross-org list; switching org (Auth) reloads list.
12. **Audit (nice-to-have)** — On create/rotate/delete, `audit.appendEntry` with action `secrets.put` / `secrets.delete` **without** value in meta.

## Non-functional requirements

1. **UI kit** — `@agentos/ui` only; kebab-case under `builtins/secrets/ui/`.
2. **Secret hygiene** — Values never written to `console`, toasts, audit meta, or error payloads; autocomplete=`off` / password managers attributes as appropriate.
3. **A11y** — Dialogs focus-trapped; reveal toggle announced; destructive confirm requires explicit action.
4. **Security** — RBAC required for session; peer header not used from browser UI; XSS-safe rendering of key names.
5. **Performance** — List of hundreds of keys remains scrollable; no N+1 reveal on load.
6. **Tests** — List metadata excludes values; UI masked-by-default; permission denied state; Activity Bar scan.
7. **Docs** — `builtins.md` Secrets manager UI + list route; threat model note unchanged (AES-GCM, master key in env).

## Done when

- [ ] Activity Bar secondary opens Secrets manager
- [ ] List / create / reveal / rotate / delete work for org vault
- [ ] List API returns metadata only; tests prove no value leakage
- [ ] Health/master-key empty state blocks writes clearly
- [ ] Docs + SDK + tests updated

## Notes

- This is **not** Auth password change (ticket **50**).
- No KMS UI in this ticket; master key remains env-only.

## Verify

- `agentos dev` → Secrets → create key → reveal → rotate → delete
- Switch org → list changes; without `secrets.write` → mutate controls disabled/hidden
- `bun test` secrets builtin + UI; `bun run ci` before PR
