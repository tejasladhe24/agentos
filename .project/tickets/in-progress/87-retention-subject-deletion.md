# 87 — Retention policies + subject deletion

**Status:** in-progress

## Goal

Support **data retention policies** and **per-person (subject) deletion** across db-store collections and files for PlacementOS / compliance-minded pilots.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **72**.

## Depends on

- Ticket **71** (tenancy) — required
- Ticket **84** (bulk/TTL) — preferred building block
- Ticket **57** (files) — done

## Done when

- [x] Org-level retention config (default TTL / legal hold flag) documented and enforced for opted-in collections
- [x] Subject deletion API: given subject id (candidate/user email), delete or anonymize matching docs + file keys
- [x] Audit log entry for deletion requests
- [x] Tests for happy path + hold blocking delete
- [x] Docs: what is / isn’t covered (backups, provider logs)

## Notes

- Not full GDPR automation — focused, auditable delete for demo + pilot contracts.
