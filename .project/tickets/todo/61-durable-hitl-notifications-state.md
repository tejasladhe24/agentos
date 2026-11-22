# 61 — Durable HITL / notifications state (scale readiness)

**Status:** todo

## Goal

Move HITL approvals (and notifications inbox state as applicable) off in-process `Map` storage onto db-store (or another portable durable backend) so a container restart does not lose pending approvals. Document cache-store Redis as a follow-up for multi-instance.

## Depends on

- Ticket **19** (HITL / notifications builtins) — done
- Ticket **16** (db-store) — done
- Ticket **54** (`agentos start`) — for production context

## Done when

- [ ] HITL approvals survive process restart
- [ ] Notifications durable enough for single-replica production (define in ticket notes if subset)
- [ ] API shapes for Shell / clients unchanged where possible
- [ ] Tests for create → restart → list/approve
- [ ] Docs: keep `max_instances` / replicas at **1** until cache/events also externalized; Redis optional follow-up

## Notes

- Optional for first Cloudflare demo with `max_instances: 1` and accepted reset-on-restart.
- Required before horizontal scale on Cloudflare, ECS, or EKS.
- Prefer db-store over Cloudflare-specific storage.
