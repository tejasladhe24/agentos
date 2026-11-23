# 100 — Python store org context + invoice-bot tenancy fix

**Status:** in-progress

## Goal

Fix sample **invoice-bot** (and the Python SDK) so tenant db-store calls send org context after ticket **71**. Peer service calls currently hit `401 org context required` because `agentos.store` had no `org_id` / `X-AgentOS-Org-Id` path and `AuthSession` omitted `orgId`.

## Depends on

- Ticket **71** (org-scoped db-store) — done
- Ticket **24** / **26** (Python `agentos` + invoice-bot) — done

## Functional requirements

1. **`AuthSession`** exposes `orgId` and `orgs` from `GET /session` (parity with `@agentos/core/api/auth`).
2. **`auth.require_org()`** FastAPI Depends returns 400 when `orgId` is missing.
3. **`store.db_store.collection(name, org_id=…, headers=…)`** sends `X-AgentOS-Org-Id` on all collection HTTP calls (query/insert/update/delete/retention/prune).
4. **invoice-bot** list / parse / payout routes use the active session `orgId` for the `invoices` collection.
5. Missing org on invoice routes → **400** `organization required` (not a 500 from db-store).

## Non-functional requirements

1. No customer `DATABASE_URL`; keep HTTP-only store client (ADR 004).
2. Python ↔ TS kit parity for org header naming (`X-AgentOS-Org-Id`).
3. Tests cover org header on collection calls + `require_org` ok/missing.
4. Docs/README example shows `org_id=session.orgId`.

## Done when

- [x] Python auth session includes `orgId` / `orgs` + `require_org()`
- [x] `collection(..., org_id=)` sends org header
- [x] invoice-bot passes `session.orgId` on all invoice store ops
- [x] Tests + README updated
- [ ] PR into `dev`; local verify: signed-in user with active org can `GET /invoices` without 500

## Notes

- Python services are peers: they typically cannot forward the browser cookie to db-store; prefer explicit `org_id` from the validated session (same pattern as crm-helper TS routes).
- Do not weaken db-store org checks.

## Verify

- `cd packages/python && uv run pytest tests/test_auth.py tests/test_store.py`
- `bun run ci`
- `agentos dev` → invoice-bot → list invoices succeeds with active org
