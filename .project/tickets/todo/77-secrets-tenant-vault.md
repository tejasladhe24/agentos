# 77 — Per-tenant credential vault (secrets)

**Status:** todo

## Goal

Upgrade builtin `secrets` from env-only reads to a **per-tenant vault** with write, encryption at rest, and rotation hooks for OAuth tokens and API keys (QuickBooks, ATS, CRM).

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **66**.

## Depends on

- Ticket **19** (secrets builtin) — done
- Ticket **71** (tenancy) — required for per-org isolation

## Done when

- [ ] API to put/get/delete secret by `(orgId, key)` with permission checks
- [ ] Values encrypted at rest (platform key or KMS env); never logged
- [ ] Rotation metadata (`rotatedAt`, optional expiry) stored
- [ ] Env fallback still works for bootstrap / local demos
- [ ] Tests: org isolation + encryption round-trip (no plaintext on disk/db assertion where feasible)
- [ ] Docs: threat model + env for master key

## Notes

- Do not store customer secrets in `agentos.config.ts`.
- CloseDesk / PlacementOS MVPs can keep one sandbox token in env until this ships.
