# 71 — Tenancy: org model + org-scoped db-store

**Status:** in-progress

## Goal

Add a first-class **organization (tenant)** model in builtin `auth` and enforce **org-scoped** reads/writes in `db-store` so every portfolio platform can isolate customer data without a retrofit later.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — shared platform layer §1; cross-platform gap formerly proposed as **54**.

## Depends on

- Ticket **15** / **56** (auth + Postgres) — done
- Ticket **16** (db-store) — done

## Done when

- [x] Auth has org membership (user ↔ org ↔ role) with APIs to create/list orgs and switch active org
- [x] Session (or request context) exposes `orgId` for API kit / Shell consumers
- [x] db-store documents are org-scoped: inserts stamp `orgId`; queries default to active org; cross-org access denied
- [x] Postgres path documents how RLS (or equivalent server-side filter) is applied; SQLite path has equivalent isolation tests
- [x] Migration / backfill story for existing unscoped collections documented
- [x] Tests: user A in org 1 cannot read org 2 docs
- [x] Concepts / builtins docs updated

## Notes

- Costliest gap to retrofit — do before TrustDesk / CloseDesk pilots.
- Prefer org on every row over separate databases per tenant for v1.
- Do not require customer `DATABASE_URL`; keep dialect inside builtins.
