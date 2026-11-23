# 89 — CloseDesk MVP (`examples/closedesk`)

**Status:** todo

## Goal

Ship CloseDesk **ask-the-client loop** MVP: categorize uncategorized transactions, mobile client link for the rest, write-back via HITL — on agentos.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — §2 + Building CloseDesk on agentos.

## Depends on

- Ticket **71** (tenancy)
- Ticket **72** (public routes) — client answer link
- Ticket **73** (email/SMS) — preferred; in-app reminder workaround OK
- Ticket **88** (TrustDesk) — start order: TrustDesk first

## Done when

- [ ] `examples/closedesk` scaffolded with core extension + ledger sync stub (env sandbox token OK)
- [ ] Client public answer link works without full login
- [ ] HITL approve → write-back pending/done path
- [ ] README + demo seed
- [ ] Deploy notes

## Notes

- Full QuickBooks/Xero OAuth waits on tickets **77** / **78**.
- Do not start until the user explicitly asks to build.
