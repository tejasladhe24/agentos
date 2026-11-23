# 76 — db-store query operators, sort, and indexes

**Status:** done

## Goal

Extend db-store `where` beyond flat equality to support **sort**, **range**, **`in`**, and documented **JSON indexes** (Postgres dialect) so CloseDesk date-range transactions, VendorGate expiry scans, and ChannelGuard price history filters are not full-table scans in the service layer.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — gap formerly **55**.

## Depends on

- Ticket **16** (db-store) — done
- Ticket **71** (tenancy) — preferred so operators compose with org scope

## Done when

- [x] Supported operators documented (`$gt` / `$gte` / `$lt` / `$lte` / `$in` / `$ne` or equivalent)
- [x] `sort` + `limit` (+ optional `offset` or cursor) on query
- [x] Nested `$`-operator objects no longer unconditionally rejected
- [x] Postgres: optional index hints / documented GIN or expression indexes for common paths
- [x] SQLite path supports the same operator subset (or clearly documents reduced support)
- [x] Tests cover operators + rejection of unsafe / unknown operators
- [x] API kit `store` client updated if request shapes change

## Notes

- Keep v1 mental model: one `documents` table, logical collections — do not invent a second ORM.
