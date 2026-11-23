# 84 — db-store bulk insert + retention/TTL

**Status:** in-progress

## Goal

Add **bulk insert** and **retention/TTL** for append-only collections (crawl snapshots, audit-like logs) so ChannelGuard and similar workloads are not one-insert-per-HTTP-call with unbounded growth.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **69**.

## Depends on

- Ticket **16** (db-store) — done
- Ticket **76** (query operators) — preferred for efficient expiry sweeps

## Done when

- [x] Bulk insert API (batch of docs, bounded size) with all-or-nothing or documented partial behavior
- [x] Per-collection or per-doc TTL / retention policy (time or max-count)
- [x] Background or on-write prune path; tests prove old rows disappear
- [x] Org scoping respected when ticket **71** is present
- [x] Docs: recommended patterns for snapshots vs mutable docs

## Notes

- MVP portfolio apps can denormalize “latest” on parent docs until this lands.
