# 88 — TrustDesk MVP (`examples/trustdesk`)

**Status:** todo

## Goal

Scaffold and ship the **TrustDesk** questionnaire-autopilot MVP as a consumer app on agentos: upload → cited drafts → HITL review → Excel export, per the portfolio brief.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — §1 + Building TrustDesk on agentos.

## Depends on

- Ticket **71** (tenancy) — strongly preferred before demo data
- Ticket **79** (vector-store) — preferred for cited retrieval; workaround: keyword/filter until ready
- Ticket **74** (events + `hitl.resolved`) — preferred
- Ticket **65** (live files/R2) — for durable uploads on deploy

## Done when

- [ ] `examples/trustdesk` via create template (`with-service`)
- [ ] Extension `questionnaires` + Python `services/questionnaires` (parse, retrieve, draft, export)
- [ ] Review queue UI (`@agentos/ui`) + HITL for low-confidence answers
- [ ] Seed: CSA CAIQ-style sample + synthetic policies
- [ ] README: draft-coverage metric target (70%+) and how to run
- [ ] Deployable on existing Cloudflare / Docker path with demo login

## Notes

- V1 modules (library, trust-center, …) are follow-ups; keep this ticket MVP-scoped.
- Do not start until the user explicitly asks to build.
