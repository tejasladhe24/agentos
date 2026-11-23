# 86 — Inbound email per org

**Status:** todo

## Goal

Receive email into the app via a **per-org inbound address**: store attachments in `files`, persist message metadata, and **publish an event** for VendorGate COI intake and similar flows.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **71**.

## Depends on

- Ticket **57** (files S3) — done
- Ticket **71** (tenancy) — required
- Ticket **72** (public routes) — provider webhooks
- Ticket **74** (durable events) — preferred for reliable handoff

## Done when

- [ ] Provision or document inbound address mapping → `orgId`
- [ ] Provider webhook verifies signature and ingests message + attachments
- [ ] Attachments land in `files`; event published (e.g. `email.received`)
- [ ] Tests with mocked provider payloads
- [ ] Docs: DNS / provider setup for demo

## Notes

- Pick one provider for v1 (e.g. inbound parse webhook); keep adapter boundary clean.
