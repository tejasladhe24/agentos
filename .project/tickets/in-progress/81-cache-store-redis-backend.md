# 81 — cache-store Redis backend

**Status:** in-progress

## Goal

Add a **Redis** backend behind the same cache-store get/set/del API so multi-instance deploys share permission caches, rate limits, and page fingerprints.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — gap formerly **53**; follow-up noted in ticket **61**.

## Depends on

- Ticket **17** (cache-store) — done

## Done when

- [x] In-memory backend remains default
- [x] When Redis URL env is set, use Redis with the same API + TTL semantics
- [x] Health reports `backend: "redis" | "memory"`
- [x] Tests: memory path + mocked Redis
- [x] Docs: env keys; note required before `max_instances` > 1

## Notes

- Portable Redis protocol (Upstash, ElastiCache, local). No Cloudflare-specific KV in core.
