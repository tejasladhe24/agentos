# 74 — Durable event queue + job scheduler

**Status:** todo

## Goal

Replace in-process SSE-only `events` with a **durable outbox/queue** (retries, at-least-once delivery) and a **scheduler** (cron / delayed jobs) so cross-module automations survive restarts and multi-instance deploys.

Also: on HITL resolve, publish **`hitl.resolved`** so extensions can react without polling.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — shared platform layer §4; gap formerly **57**; HITL follow-up from ticket **61**.

## Depends on

- Ticket **19** (events / hitl builtins) — done
- Ticket **61** (durable HITL) — done
- Ticket **16** (db-store) — done

## Done when

- [ ] Publish path writes durable records (outbox / queue table) in addition to or instead of memory-only fanout
- [ ] Workers / consumers can claim, ack, and retry with backoff; poison-message story documented
- [ ] Scheduler API: register cron or run-at jobs that emit events or call a configured HTTP route
- [ ] SSE (or equivalent) live subscribe still works for Shell when a process is up
- [ ] HITL approve/reject publishes `hitl.resolved` with approval id + decision
- [ ] Tests: restart mid-queue does not drop undelivered events; cron fires in test clock or short interval
- [ ] Docs: single-replica vs multi-replica guidance

## Notes

- Portable first (db-store / Postgres). Cloud-specific queues (SQS, Cloud Tasks) can be adapters later.
- Until this lands, portfolio MVPs may use host cron hitting an extension route.
