# 72 — Public (unauthenticated) extension routes

**Status:** todo

## Goal

Allow selected extension UI pages and API routes to be reachable **without a signed-in session** (trust center, client answer links, vendor/candidate portals), while keeping the Shell auth gate for everything else.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — TrustDesk trust center / CloseDesk client links; gap formerly **59**.

## Depends on

- Ticket **43** (auth gate + `agentos.config.ts`) — done
- Ticket **53** (production gateway) — done
- Ticket **71** (tenancy) — preferred so public tokens can bind to an org

## Done when

- [ ] Config (or `meta.json`) can declare public UI paths and/or public API route prefixes per extension
- [ ] Shell does not redirect those UI paths to `/login`
- [ ] Gateway / API kit skips session requirement for declared public API routes; other routes still 401
- [ ] Public access is constrained (signed expiring token, magic link, or similar) — not a wide-open bypass
- [ ] Tests: public path ok without cookie; private path still gated
- [ ] Docs: how TrustDesk-style portals use public routes safely

## Notes

- External viewers are first-class users in the briefs (NDA click-through, W-9 upload, COI upload).
- Prefer short-lived signed links over long-lived anonymous cookies.
