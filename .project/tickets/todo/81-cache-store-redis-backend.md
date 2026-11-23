# 81 — cache-store Redis backend

**Status:** todo

## Goal

Add a **Redis** backend behind the same cache-store get/set/del API so multi-instance deploys share permission caches, rate limits, and page fingerprints.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — gap formerly **53**; follow-up noted in ticket **61**.

## Depends on

- Ticket **17** (cache-store) — done

## Done when

- [ ] In-memory backend remains default
- [ ] When Redis URL env is set, use Redis with the same API + TTL semantics
- [ ] Health reports `backend: "redis" | "memory"`
- [ ] Tests: memory path + mocked Redis
- [ ] Docs: env keys; note required before `max_instances` > 1

## Notes

- Portable Redis protocol (Upstash, ElastiCache, local). No Cloudflare-specific KV in core.
