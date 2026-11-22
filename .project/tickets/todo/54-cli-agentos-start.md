# 54 — CLI `agentos start` (production process + static shell)

**Status:** todo

## Goal

Add `agentos start`: production entrypoint that starts builtins + customer Bun APIs + Python services (reuse `ProcessManager` / discovery from `agentos dev`) and serves the built consumer `dist/` plus the portable gateway on `PORT` (default **8080**).

This is the **image CMD** for Cloudflare Containers, Cloud Run, ECS, and EKS — not Cloudflare-specific.

## Depends on

- Ticket **27** (`agentos dev` / `build`) — done
- Ticket **53** (production gateway handlers)

## Done when

- [ ] `agentos start` registered in CLI (`parse-args` / `run.ts`)
- [ ] Spawns builtins, customer Bun `api/server.ts`, and Python services like `dev` (without Vite)
- [ ] `Bun.serve` on `PORT` / `8080`: gateway handlers → static `dist/` (incl. iframe HTML) → SPA `index.html` fallback
- [ ] `GET /healthz` reports overall readiness (gateway up; document child-process policy)
- [ ] Sets / documents `AGENT_OS_GLOBAL_GATEWAY_URL` default for production (`http://127.0.0.1:8080` in-process)
- [ ] Local verify: `agentos build` then `agentos start` serves Shell + `/api/ext/*`
- [ ] Help / docs mention `start` as the production entrypoint

## Notes

- Reuse `discoverBunApis`, `discoverPythonServices`, `BUILTIN_SERVERS`, `ProcessManager`.
- Vite preview is **not** the production server — `start` replaces that escape hatch.
- Single replica assumed until tickets **60** / **61** externalize in-memory state.
