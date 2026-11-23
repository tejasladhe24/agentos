# 83 — `meta.json`: Bun API + linked Python service per extension

**Status:** todo

## Goal

Allow one extension to declare **both** a Bun `api/` and a linked **Python service** (today `meta.json` has a single `api` block), matching TrustDesk’s questionnaires pattern (Python AI core + Bun modules calling it via gateway).

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — gap formerly **64**.

## Depends on

- Ticket **10** / **13** (scanner + gateway proxy) — done
- Ticket **27** / **54** (CLI process model) — done

## Done when

- [ ] Schema supports Bun routes + Python service together (backward compatible with single `api`)
- [ ] Scanner / registry / gateway expose both upstreams under one extension id (or documented subpaths)
- [ ] CLI `dev` / `start` boots both processes
- [ ] Fixture extension + tests
- [ ] Docs + concepts updated

## Notes

- Until this ships, AI-heavy core stays a Python-backed extension; other modules call `/api/ext/<core-id>/*`.
