# Architecture

AgentOS is a **convention-over-configuration** extension platform: an empty **Shell** host, **sandboxed UI iframes** (Comlink), and **per-feature HTTP backends** (Bun TS APIs or Python services), plus **driving builtins** for auth, data, cache, and AI.

## High-level

```text
Browser:  Shell (mountShell) + extension UI iframes
    │
    ├─ Comlink (MessageChannel per iframe) ── HostAPI
    │
    └─ HTTP ── Gateway (@agentos/core/gateway fetch handlers)
                  │         ▲
                  │         └─ Vite Connect adapter (@agentos/core/vite) in dev
                  │         └─ Bun.serve / host adapters under deploy/ in prod
                  ├─ /api/agent/*  → control plane → builtin ai / hitl
                  └─ /api/ext/:id/* → proxy → Bun API or Python service
                                              │
                                              └─ clients → builtins
                                                   auth | db-store | cache-store | ai | …
```

## Comlink sandbox

- Each extension `ui/page.tsx` | `sidebar.tsx` | `widget.tsx` loads in `iframe sandbox="allow-scripts allow-same-origin allow-forms"`.
- App-level `ui/dashboard.tsx` (passed to `mountShell`) is the Home surface, rendered in-process (not an iframe). Optional extension `ui/widget.tsx` cards appear below on Home. Optional `ui/dashboard-sidebar.tsx` is the Home sidebar (also in-process).
- Left sidebar is an **active-extension** host: the active extension’s `ui/sidebar.tsx`, or Home’s `dashboardSidebar`. When neither applies, the column collapses. Extension Manager and HITL Approvals are Shell panels in that same left column (not right sheets). Status bar and topbar remain **global** chrome (topbar v1: sidebar toggle, branding, settings stub; contribution slots reserved).
- Transport: **dual MessageChannel** per iframe (not shared `windowEndpoint` — avoids cross-talk).
- UI uses `@agentos/core/client` hooks; never raw `postMessage`.

## Gateway

- **Core** lives in `@agentos/core/gateway` as portable `(Request) => Response | null` handlers — host-agnostic (no Vite Connect, no `@cloudflare/*`). Platform adapters (Vite Connect bridge, future `deploy/*`) mount the same handlers.
- Discovers builtins + customer extensions via Vite scanner → `virtual:agentos-registry` (dev); production hosts reuse the registry model (see `agentos start`).
- Loads consumer `agentos.config.ts` → `virtual:agentos-config` (auth + branding runtime subset).
- Serves consumer `public/` at `/_public/<path>` (dev + preview/build copy into `dist/_public/`). Missing `/_public/<file>` returns **HTTP 404** with a minimal HTML body (gateway answers before SPA fallback).
- Proxies `/api/ext/:id/*` to upstream from `meta.json` (port, language `bun` | `python`) at `http://127.0.0.1:<port>` (sidecar-friendly).
- Disabled **customer** extensions → 403 + UI unmounted. **Builtins** cannot be disabled.

## SPA paths vs gateway prefixes

| Kind                | Examples                                 | Who answers                                                     |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Known SPA workspace | `/`                                      | AuthGate → Shell (session required)                             |
| Public auth         | `/login`, `/register`, …                 | AuthGate → auth pages (outside Shell chrome)                    |
| Unknown SPA path    | `/totally-missing`, `/__public/…` (typo) | AuthGate → **Not Found** UI (no session)                        |
| Reserved gateway    | `/_public/…`, `/__agentos/…`, `/api/…`   | Gateway handlers (HTTP status); **not** claimed as Shell routes |

Correct public assets use a **single** underscore: `/_public/<path>`. A double-underscore typo (`/__public/…`) is an unknown SPA path and shows the client Not Found page.

## Builtins (platform)

See [builtins.md](./builtins.md). Hard rules:

- Only **db-store** holds SQL credentials (Drizzle).
- Only **cache-store** owns cache.
- Only **auth** (Better Auth) owns identity + RBAC.

## Customer features

- **Extension** folder: `ui/`, `agent/`, optional `api/routes/` (Bun).
- **Service** folder: Python FastAPI under `services/<id>/` when `meta.api.language === "python"`.

## Runtime tooling

| Concern           | Tool                        |
| ----------------- | --------------------------- |
| Workspace install | **pnpm**                    |
| Run TS/JS         | **Bun** (`bun run`, `bunx`) |
| Python services   | **uv** / uvicorn            |
| Host UI build     | Vite (via Bun)              |

## Related ADRs

- [001 pnpm + Bun hybrid](./adr/001-pnpm-bun-hybrid.md)
- [002 Better Auth owns auth+RBAC](./adr/002-better-auth-auth-rbac.md)
- [003 Python services outside extensions](./adr/003-python-services-outside-extensions.md)
- [004 db-store sole SQL owner](./adr/004-db-store-sole-sql-owner.md)
- [005 Comlink MessageChannel](./adr/005-comlink-messagechannel.md)
- [006 Vercel AI SDK v7 owns platform AI](./adr/006-vercel-ai-sdk.md)
