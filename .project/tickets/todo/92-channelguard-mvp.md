# 92 — ChannelGuard MVP (`examples/channelguard`)

**Status:** todo

## Goal

Ship ChannelGuard **MAP monitor** MVP: SKU upload, crawl controlled/mock URLs, below-MAP violations with screenshots, digest view — on agentos.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — §5 + Building ChannelGuard on agentos.

## Depends on

- Ticket **71** (tenancy)
- Ticket **80** (worker service) — preferred; in-process Playwright workaround OK
- Ticket **74** (scheduler) — preferred; host cron workaround OK
- Ticket **91** (PlacementOS) — start order 5th

## Delivery type

Your own vertical product: demo as `tenancy.preset: 'saas'` (each consumer brand is an org). Delivered to a single brand, use `internal`. Depends on ticket **121** (tenancy presets) — preferred.

## Done when

- [ ] `examples/channelguard` + `map-monitor` + `services/crawler`
- [ ] Mock storefronts or books.toscrape.com targets only (no unauthorized retailer scraping)
- [ ] Violations board with screenshots; notice approval via HITL
- [ ] In-app digest (email waits on **73**)
- [ ] README: detection latency + match precision notes
- [ ] Deploy notes

## Notes

- Respect robots.txt; proxy rotation out of MVP scope.
- Do not start until the user explicitly asks to build.
