# Tickets

Work items live in status folders. **Do them in numeric order** (filename prefix).

| Status          | Folder         |
| --------------- | -------------- |
| Backlog / ready | `todo/`        |
| Active          | `in-progress/` |
| Finished        | `done/`        |

### Agent status rules

1. When implementation **starts**, move the ticket `todo/` → `in-progress/` and set `**Status:** in-progress`.
2. When implementation **finishes**, leave the ticket in `in-progress/`. **Do not** move it to `done/`.
3. Only the **ticket reconciliation** process moves tickets into `done/` (and updates `**Status:** done`).

Agents must never promote tickets to `done/` themselves.

## Order (1 → 30)

1. Reset legacy workspace
2. Scaffold monorepo
3. Core package exports
4. Comlink SDK
5. Shell UI skeleton
6. Extension host iframes
7. Client hooks
8. Extension Manager
9. Command palette / toasts
10. Vite plugin scanner
11. Virtual registry
12. Virtual iframe entries
13. Gateway proxy
14. Agent control plane
15. Builtin auth
16. Builtin db-store
17. Builtin cache-store
18. Builtin ai
19. Supporting builtins
20. API kit app + loadRoutes
21. API kit auth
22. API kit store
23. Remaining API kit domains
24. Python `agentos` package
25. Sample crm-helper
26. Sample invoice-bot + service
27. CLI `agentos dev`
28. `.project` docs
29. E2E verification
30. (Later) Next.js host adapter spike
31. Install agent skills + ADR (pnpm workspaces / Bun runtime) — **done** (setup)
32. `.project` docs — **done** (setup)
33. Global + extension env config (`@t3-oss/env-core`) — keys export + app extend
34. Extension icons via `meta.json` (replace hardcoded Activity Bar `CubeIcon`)
35. Custom icon for sample `crm-helper`
36. Custom icon for sample `invoice-bot`
37. Custom icon for sample `demo`
38. Activity Bar primary (top→bottom) + secondary (bottom→top, builtins only)
39. Contextual sidebar (per active extension) + Shell panels (manager / HITL) in left sidebar
40. App-level `ui/dashboard.tsx` Home surface (mountShell dashboard option)
41. Chore: git / package metadata + README refresh
42. CLI package: scaffold client app (`create` / `init`, CRA / shadcn-init style)
43. Auth gate routes (`/login` `/register` `/reset-password`) + `agentos.config.ts`
44. Branding in `agentos.config.ts` + `/_public` consumer assets
45. Organize Shell components/hooks/lib by feature (auth, ui-contribs, …)
46. Hide empty active-extension UI contrib hosts + Home `ui/dashboard-sidebar.tsx`
47. Shell topbar (sidebar toggle, branding, settings stub)
48. Builtin `settings` extension + topbar Settings opens it
49. Shell not-found (404) page for unknown SPA paths
50. Auth account settings panel (profile / roles / security — not just sign-out)
51. Chore: monorepo clean + Python uv sync on install
52. Ticket reconciliation: promote covered in-progress → done — **done** (43–51 → `done/`)
53. Production gateway handlers (Request/Response) — portable; Vite adapts — **done**
54. CLI `agentos start` (production process + static Shell) — **done**
55. Auth production hardening (secret, secure cookies, no demo seed) — **done**
56. Auth Postgres backend (ephemeral-disk safe) — **done**
57. Files S3-compatible backend (R2 / S3 / GCS via env) — **done**
58. Root Dockerfile + `.dockerignore` (portable image) — **done**
59. Deploy layout + portable runbook (`deploy/`; migration notes) — **done**
60. Persist extension enable-state (db-store) — **done**
61. Durable HITL / notifications state (scale readiness) — **done**
62. `deploy/cloudflare` Worker + Containers adapter (thin; disposable) — **done**
63. Cloudflare CI deploy workflow — **done**
64. Cloudflare deploy smoke checks (runbook; live curls → **65**) — **done**
65. Execute Cloudflare live smoke against deployed `BASE_URL`
66. Ticket reconciliation: promote covered in-progress → done — **done** (53–63 → `done/`)
67. Extension iframe production CSS links — **done**
68. Deploy workflow command smoke (`pnpm run ci`) — **done**
69. GitHub Actions Node 22 for Wrangler — **done**

70. Tenancy: org model + org-scoped db-store — **in-progress**

**Open:** `todo/` — **29** (E2E), **30** (Next host spike), **65** (R2 files round-trip after enabling R2). `in-progress/` — **71** (tenancy).

**Deploy order:** **53 → 54 → 55 → 56 → 57 → 58 → 59 → 62 → 63 → 64** (done through **64**); **60** / **61** / **67**–**69** done; finish files durability via **65** after enabling R2.

**Runtime policy:** `pnpm install` for the monorepo; `bun run` / `bun` for all TS/JS services (never Node).

**Agents:** load `agentos-architecture` + `agentos-ticket-planner` before planning any remaining todo ticket.
