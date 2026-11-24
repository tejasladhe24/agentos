# 91 — PlacementOS MVP (`examples/placementos`)

**Status:** todo

## Goal

Ship PlacementOS **submission packet** MVP: assemble candidate packet, checklist, and recruiter review — on agentos.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — §4 + Building PlacementOS on agentos.

## Depends on

- Ticket **71** (tenancy)
- Ticket **72** (public routes) — candidate links as needed
- Ticket **90** (VendorGate) — start order 4th

## Delivery type

Your own vertical product: demo as `tenancy.preset: 'saas'` (each staffing agency is an org; candidates use links). Delivered to one agency, use `internal`, or `customer-facing` if its hiring companies get their own portal orgs. Depends on ticket **121** (tenancy presets) — preferred.

## Done when

- [ ] `examples/placementos` + core submission-packet extension
- [ ] Packet checklist UI + file attachments via `files`
- [ ] HITL or in-app approve before “submit”
- [ ] README + demo seed
- [ ] Deploy notes

## Notes

- ATS OAuth / calendar sync waits on **77** / **78**; subject deletion on **87**.
- Do not start until the user explicitly asks to build.
