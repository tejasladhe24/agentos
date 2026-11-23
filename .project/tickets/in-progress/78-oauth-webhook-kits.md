# 78 — OAuth connect + inbound webhook kits

**Status:** in-progress

## Goal

Add reusable **OAuth connect/callback** helpers and an **inbound webhook** kit (signature verify, replay protection, idempotency) in the Bun API kit (and Python equivalents where needed) so CloseDesk and PlacementOS do not each reinvent ledger/ATS OAuth.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **67**.

## Depends on

- Ticket **23** (API kit domains) — done
- Ticket **72** (public routes) — callbacks/webhooks are often unauthenticated
- Ticket **77** (tenant vault) — store refresh tokens per org

## Done when

- [x] OAuth start + callback helpers documented under `@agentos/core/api/*` (provider-agnostic)
- [x] Webhook helper: HMAC/signature check, timestamp skew window, idempotency key store
- [x] Example route(s) in docs or a sample extension stub
- [x] Tokens written via secrets vault (ticket **77**), not plaintext env in production path
- [x] Tests for signature failure, replay, and duplicate delivery
- [x] Python `agentos` helpers or clear HTTP-level guidance for services

## Notes

- Provider-specific apps (Intuit, Xero, Bullhorn) stay in consumer extensions; the kit is generic.
