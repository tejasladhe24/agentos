# 61 — Durable HITL / notifications state (scale readiness)

**Status:** done

## Goal

Move HITL approvals (and notifications inbox state as applicable) off in-process `Map` storage onto db-store (or another portable durable backend) so a container restart does not lose pending approvals. Document cache-store Redis as a follow-up for multi-instance.

## Depends on

- Ticket **19** (HITL / notifications builtins) — done
- Ticket **16** (db-store) — done
- Ticket **54** (`agentos start`) — for production context

## Done when

- [x] HITL approvals survive process restart
- [x] Notifications durable enough for single-replica production (full recent inbox via db-store collection `notifications`)
- [x] API shapes for Shell / clients unchanged where possible
- [x] Tests for create → restart → list/approve
- [x] Docs: keep `max_instances` / replicas at **1** until cache/events also externalized; Redis optional follow-up

## Notes

- Optional for first Cloudflare demo with `max_instances: 1` and accepted reset-on-restart.
- Required before horizontal scale on Cloudflare, ECS, or EKS.
- Prefer db-store over Cloudflare-specific storage.
- Collections: `hitl_approvals`, `notifications`. Peer env: `AGENT_OS_EXT_HITL_DB_STORE_*`, `AGENT_OS_EXT_NOTIFICATIONS_DB_STORE_*`.
