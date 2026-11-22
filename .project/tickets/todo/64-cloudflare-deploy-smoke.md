# 64 — Cloudflare deploy smoke checks

**Status:** todo

## Goal

Prove the Cloudflare deployment is alive: health, auth session, one Bun extension API, and the Python `invoice-bot` path. Complements ticket **29** (full product E2E) with a **deploy-focused** smoke list against the live URL.

## Depends on

- Ticket **62** (Cloudflare adapter)
- Ticket **63** (CI) — optional for manual smoke first
- Tickets **54**–**58** (start + image + durable auth/files)

## Done when

- [ ] Checklist documented (runbook or ticket notes) for the deployed base URL
- [ ] `GET /healthz` (or agreed health) succeeds
- [ ] Sign-up / sign-in works; session cookie survives reload
- [ ] `/api/ext/crm-helper/*` (or demo) responds through the Worker → container
- [ ] `/api/ext/invoice-bot/*` responds (Python in container)
- [ ] File upload round-trip if R2 configured (ticket **57**)
- [ ] Gaps filed as follow-ups; pointer from ticket **29** if useful

## Notes

- Manual smoke is enough for v1; automated Playwright against preview URL is optional follow-up.
- Keep `max_instances: 1` until **60** / **61** if relying on in-memory HITL/cache.
