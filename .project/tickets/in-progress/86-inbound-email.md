# 86 — Inbound email per org

**Status:** in-progress

## Goal

Receive email into the app via a **per-org inbound address**: store attachments in `files`, persist message metadata, and **publish an event** for VendorGate COI intake and similar flows.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **71**.

## Depends on

- Ticket **57** (files S3) — done
- Ticket **71** (tenancy) — required
- Ticket **72** (public routes) — provider webhooks
- Ticket **74** (durable events) — preferred for reliable handoff

## Done when

- [x] Provision or document inbound address mapping → `orgId`
- [x] Provider webhook verifies signature and ingests message + attachments
- [x] Attachments land in `files`; event published (e.g. `email.received`)
- [x] Tests with mocked provider payloads
- [x] Docs: DNS / provider setup for demo

## Notes

- Pick one provider for v1 (e.g. inbound parse webhook); keep adapter boundary clean.
- v1 providers: **Mailgun** Inbound Parse + **fixture** (HMAC JSON) for local/tests.
