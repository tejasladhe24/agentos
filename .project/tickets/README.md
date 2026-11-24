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
70. Solo freelancer portfolio + $5k–$10k pipeline (personal; not AgentOS platform)
71. Tenancy: org model + org-scoped db-store — **done**
72. Public (unauthenticated) extension routes — **done**
73. Notifications: email and SMS delivery channels — **done**
74. Durable event queue + job scheduler (+ `hitl.resolved`) — **done**
75. Auth: SAML/OIDC SSO + role admin API — **done**
76. db-store query operators, sort, and indexes — **done**
77. Per-tenant credential vault (secrets) — **done**
78. OAuth connect + inbound webhook kits — **done**
79. `vector-store` builtin (pgvector) — **done**
80. Worker service type (long jobs / headless browser) — **done**
81. cache-store Redis backend — **done**
82. SDK parity: files, events, audit, secrets, notifications — **done**
83. `meta.json`: Bun API + linked Python service per extension — **done**
84. db-store bulk insert + retention/TTL — **done**
85. AI: structured JSON output + file/image inputs — **done**
86. Inbound email per org — **done**
87. Retention policies + subject deletion — **done**
88. TrustDesk MVP (`examples/trustdesk`)
89. CloseDesk MVP (`examples/closedesk`)
90. VendorGate MVP (`examples/vendorgate`)
91. PlacementOS MVP (`examples/placementos`)
92. ChannelGuard MVP (`examples/channelguard`)
93. Ticket reconciliation: promote covered in-progress → done — **done** (71–87 → `done/`)
94. Upgrade Node dependency to v24 — **in-progress**
95. Proper loading states (extension frames, HostProvider, HITL/invoice fetch, gateway stream) — **in-progress**
96. Files Drive-style UI (fully functional)
97. Audit Activity manager UI (fully functional)
98. Secrets manager UI (fully functional)
99. Email manager UI (send + receive, fully functional) — **in-progress**
100. Python store org context + invoice-bot tenancy fix — **in-progress**
101. Extension-registered Settings — **in-progress**
102. Shell keep views mounted — **in-progress**
103. Tenant integrations foundation (BYOK: per-org records + vault refs, env fallback)
104. User-owned secrets in the vault (personal OAuth tokens)
105. Email + SMS sending BYOK (Resend / Cloudflare / Twilio)
106. Inbound email via Resend (platform + BYOK, webhook auto-registration); remove Mailgun
107. Inbound email via Cloudflare Email Worker (platform default)
108. AI: real model providers (platform env)
109. AI BYOK (per-org provider keys)
110. Files: storage mounts foundation (adapters, `files://` refs, sidebar mounts)
111. Files: S3-compatible org mounts (presets)
112. Files: UploadThing + Vercel Blob org mounts
113. Files: personal mounts + Google Drive
114. Files: OneDrive + SharePoint personal mounts
115. (Later) Inbound email via an org's own Cloudflare account
116. (Later) Files: more storage adapters (Dropbox, Box, Azure, …)
117. (Later) Files: bulk move between mounts
118. (Later) Per-org OAuth app credentials
119. Files: streaming uploads and a higher upload cap
120. Files: UploadThing listing from the index + SDK cleanup

**Open:** `todo/` — **29**, **30**, **65**, **70**, **88**–**92**, **115**–**120**. `in-progress/` — **94**–**114** (plus stale peers pending reconciliation).

**BYOK + storage mounts order:** **103 → 104**; email **105 → 106 → 107**; AI **108 → 109**; files **110 → 111 → 112 → 113 → 114**. Later: **115**–**118**. Follow-ups: **119** (streaming uploads), **120** (UploadThing index listing).

**Deploy order:** **53 → 54 → 55 → 56 → 57 → 58 → 59 → 62 → 63 → 64** (done through **64**); **60** / **61** / **67**–**69** done; finish files durability via **65** after enabling R2.

**Portfolio platform capabilities:** **71**–**87** done (reconciled in **93**). Product MVPs next: **88 → 89 → 90 → 91 → 92**. Builtin operator UIs: **96 → 97 → 98 → 99**. Source: [`.project/portfolio/portfolio-briefs.md`](../portfolio/portfolio-briefs.md). Do not start build tickets until the user explicitly asks.

**Runtime policy:** Node ≥ 24 for pnpm tooling; `pnpm install` for the monorepo; `bun run` / `bun` for all TS/JS services (never Node as a service runtime).

**Agents:** load `agentos-architecture` + `agentos-ticket-planner` before planning any remaining todo ticket.
