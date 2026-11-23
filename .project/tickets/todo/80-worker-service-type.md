# 80 — Worker service type (long jobs / headless browser)

**Status:** todo

## Goal

Support a **worker** service type (not only HTTP request/response processes): concurrency limits, timeouts, optional **headless browser** image, and egress/proxy config for ChannelGuard crawls and similar long jobs.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — ChannelGuard `services/crawler`; gap formerly **68**.

## Depends on

- Ticket **24** / **27** / **54** (Python package, CLI, start) — done
- Ticket **74** (scheduler) — preferred for triggering workers

## Done when

- [ ] `meta.json` / service config can declare `kind: "worker"` (or equivalent) with concurrency + timeout
- [ ] CLI / process supervisor starts workers distinctly from HTTP APIs
- [ ] Documented Playwright (or similar) base image / Dockerfile fragment for browser workers
- [ ] Optional egress/proxy env knobs documented (rotation out of scope for MVP)
- [ ] Example stub or ChannelGuard-oriented notes in docs
- [ ] Tests or smoke: worker process registers health and respects concurrency=1 in fixture

## Notes

- Until this ships, ChannelGuard MVP may run Playwright inside the HTTP Python service with a hard concurrency cap.
