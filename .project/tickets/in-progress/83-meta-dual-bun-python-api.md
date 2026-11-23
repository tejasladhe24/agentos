# 83 — `meta.json`: Bun API + linked Python service per extension

**Status:** in-progress

## Goal

Allow one extension to declare **both** a Bun `api/` and a linked **Python service** (today `meta.json` has a single `api` block), matching TrustDesk’s questionnaires pattern (Python AI core + Bun modules calling it via gateway).

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — gap formerly **64**.

## Depends on

- Ticket **10** / **13** (scanner + gateway proxy) — done
- Ticket **27** / **54** (CLI process model) — done

## Done when

- [x] Schema supports Bun routes + Python service together (backward compatible with single `api`)
- [x] Scanner / registry / gateway expose both upstreams under one extension id (or documented subpaths)
- [x] CLI `dev` / `start` boots both processes
- [x] Fixture extension + tests
- [x] Docs + concepts updated

## Notes

- Dual shape: Bun `api` + sibling `service` (`mount` default `/_service`). Python-only keeps `api.language: "python"`.
- Until dual is used in a product app, AI-heavy core can still be a Python-only extension; other modules call `/api/ext/<core-id>/*`.
