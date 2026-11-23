# 90 — VendorGate MVP (`examples/vendorgate`)

**Status:** todo

## Goal

Ship VendorGate **COI checker** MVP: upload certificate → extract limits/dates → expiry tracking + reminders — on agentos.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — §3 + Building VendorGate on agentos.

## Depends on

- Ticket **71** (tenancy)
- Ticket **72** (public routes) — vendor upload links
- Ticket **85** (structured/multimodal AI) — preferred for PDF extraction
- Ticket **89** (CloseDesk) — start order 3rd after Trust/Close

## Done when

- [ ] `examples/vendorgate` + COI extension/service
- [ ] Extracted fields stored with expiry; calendar/reminder stub
- [ ] Vendor upload path (public or signed link)
- [ ] README + demo seed PDFs
- [ ] Deploy notes

## Notes

- Inbound email COI intake waits on ticket **86**.
- Do not start until the user explicitly asks to build.
