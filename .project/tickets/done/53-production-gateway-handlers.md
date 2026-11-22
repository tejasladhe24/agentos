# 53 — Production gateway handlers (Request/Response)

**Status:** done

## Goal

Extract the Shell gateway from Vite Connect middleware into **portable** `(Request) => Response | null` handlers so any host (`agentos start`, Cloudflare Container, Cloud Run, ECS, EKS) can reuse the same routing without depending on Vite or Workers.

Cover today’s gateway surfaces:

- `/_public/*` consumer assets
- extension enable/disable control plane
- `/api/agent/*` agent control plane
- `/api/ext/:id/*` upstream proxy
- extension iframe HTML entry serving

Vite’s `agentos()` plugin must keep working via a thin Connect adapter over the same handlers.

## Depends on

- Ticket **13** (gateway proxy) — done
- Ticket **14** (agent control plane) — done
- Ticket **27** (CLI) — done
- Ticket **44** (`/_public`) — done

## Done when

- [x] Gateway route logic lives as fetch-style handlers under `@agentos/core` (not Connect-only)
- [x] Vite plugin mounts the same handlers through a Connect bridge (dev + preview unchanged)
- [x] No `@cloudflare/*` or platform SDK imports in `@agentos/core`
- [x] Unit tests cover path parsing / proxy / enable middleware behavior at the fetch layer
- [x] Docs note: gateway core is host-agnostic; adapters live under `deploy/`

## Notes

- Keep upstream default `http://127.0.0.1:<port>` for in-container / local multi-process (sidecar-friendly).
- Do not implement `agentos start` here — that is ticket **54**.
- Migration rule: app logic stays in the container/image; edge Workers stay disposable.
