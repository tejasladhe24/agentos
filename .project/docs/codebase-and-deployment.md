# AgentOS codebase and deployment (plain-language guide)

A map of what lives in this repo, how the pieces talk to each other, and how a built app reaches the internet. Written for humans who want the whole picture without reading every ADR first.

**Scope:** platform work through ticket **87** (tenancy through retention). Portfolio product apps (TrustDesk and friends, tickets **88+**) are not built yet — only the sample `examples/client-app`.

For precise APIs and env tables, see [builtins.md](./builtins.md), [architecture.md](./architecture.md), and the [deploy runbook](../../deploy/README.md).

---

## 1. What AgentOS is (one paragraph)

AgentOS is a **framework for building products as plug-in features**. Your product (a “consumer app”) mounts a shared **Shell** UI. Each feature is an **extension** (UI in a sandboxed iframe, optional Bun API, optional Python service). Shared platform jobs — login, database, files, AI, approvals, email — live in always-on **builtins**. You never give each feature its own `DATABASE_URL`; features call the platform instead.

---

## 2. Repo map (what sits where)

```text
agentos/
├── packages/
│   ├── core/          # Framework: Shell, gateway, CLI, Bun API kit, builtins
│   ├── ui/            # Shared buttons/inputs (shadcn + Tailwind)
│   └── python/        # Python SDK (`agentos.*`) for services
├── examples/
│   └── client-app/    # Reference product (demo + crm-helper + invoice-bot)
├── services/          # Sample Python backends (e.g. invoice-bot)
├── templates/         # `agentos create` starters (minimal / extension / service)
├── deploy/
│   ├── README.md      # Portable container contract + env checklist
│   ├── cloudflare/    # Thin Worker → Container adapter (current cloud)
│   └── docker/        # Optional Playwright fragment for browser workers
├── Dockerfile         # Portable production image (not Cloudflare-specific)
├── .project/docs/     # Concepts, architecture, builtins, ADRs
└── .project/tickets/  # Work items (todo → in-progress → done)
```

| Area                      | Job                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| **`@agentos/core`**       | The platform: Shell, Comlink client, gateway HTTP handlers, Vite plugin, `agentos` CLI, all builtins |
| **`@agentos/ui`**         | Shared React controls — use these instead of raw `<button>` / `<input>`                              |
| **`agentos` (Python)**    | Same platform ideas for FastAPI services                                                             |
| **`examples/client-app`** | A real product that mounts the Shell; prove the stack works end-to-end                               |
| **`deploy/`**             | How the same Docker image is wired to a cloud (today: Cloudflare)                                    |

**Tooling rule:** **pnpm** installs the monorepo; **Bun** runs all TypeScript/JavaScript; **uv** runs Python. Do not run product APIs with Node.

---

## 3. Big picture: request path

```text
Browser
  │
  │  Shell UI (login, Activity Bar, Home, iframes)
  │  Extension pages talk to the host via Comlink (not raw postMessage)
  │
  ▼
Gateway  (@agentos/core/gateway)
  │  Serves the SPA, /_public assets, /healthz
  │  Proxies /api/ext/<extension-id>/* to a local port
  │  Proxies /api/agent/* to AI / HITL control plane
  │
  ├── Bun API process     (extension api/routes, or a builtin)
  └── Python service      (services/<id>/, when meta.json says so)
        │
        └── calls builtins over HTTP
              auth · db-store · cache-store · files · ai · …
```

**Dev:** Vite + `@agentos/core/vite` mounts the same gateway handlers.  
**Prod:** `agentos build` then `agentos start` — no Vite; Bun serves static Shell + gateway and starts child processes.

---

## 4. The three building blocks

### Consumer app (your product)

Lives under `examples/` (or a new app from `agentos create`). Owns:

- `agentos.config.ts` — branding, auth flags, public-route config
- `ui/dashboard.tsx` — Home screen (in-process, not an iframe)
- `extensions/<id>/` — product features
- `services/<id>/` — Python backends when needed
- `src/env.ts` — secrets and env via `@t3-oss/env-core` (never put secrets in config)

### Extension (a feature)

Typical folder:

```text
extensions/crm-helper/
  meta.json          # id, icon, ports, optional Python link, public routes
  ui/page.tsx        # main canvas (iframe)
  ui/sidebar.tsx     # left sidebar when this extension is active
  agent/             # tools / skills / instructions for the AI builtin
  api/               # optional Bun routes (server.ts + routes/**)
```

- **Customer** extensions can be turned off in Extension Manager.
- **Builtin** extensions are locked on (platform).

An extension can be:

| Shape          | Meaning                                                               |
| -------------- | --------------------------------------------------------------------- |
| UI only        | Declarations + iframe UI                                              |
| Bun API        | File-based routes on a loopback port                                  |
| Python service | FastAPI under `services/<id>/`                                        |
| Bun + Python   | Both; Python is reached at `/api/ext/<id>/_service/*` (ticket **83**) |
| Worker         | Python `kind: "worker"` for long jobs / crawls (ticket **80**)        |

### Builtin (platform feature)

Always running. Customer code talks to them through `@agentos/core/api/*` or Python `agentos.*`.

| Builtin           | Plain English                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| **auth**          | Sign-in, sessions, RBAC, **organizations (tenants)**, SSO (OIDC/SAML), role admin                               |
| **db-store**      | The only place that holds product SQL; org-scoped documents; query ops; bulk insert; retention / subject delete |
| **cache-store**   | Shared cache (memory, or Redis when URL is set)                                                                 |
| **ai**            | Text / image / embed; optional JSON schema + file/image inputs                                                  |
| **hitl**          | Human approval queue (durable); publishes `hitl.resolved` when decided                                          |
| **events**        | Durable outbox + claim/ack workers + cron/delayed jobs; SSE for live Shell                                      |
| **files**         | Blobs — local disk or S3-compatible (R2 / S3 / GCS)                                                             |
| **notifications** | In-app inbox + email/SMS channels (Resend / Cloudflare Email / Twilio, or log sink)                             |
| **secrets**       | Per-org encrypted vault + env fallback for bootstrap                                                            |
| **audit**         | Append-only “who did what”                                                                                      |
| **vector-store**  | Org-scoped embeddings (pgvector; in-memory for local/tests)                                                     |
| **inbound-email** | Per-org inbound address → attachments in files + `email.received` event                                         |
| **settings**      | App preferences UI in the Shell                                                                                 |

Hard rules: only **auth**, **db-store**, and **vector-store** may hold SQL credentials. Customers never get a product `DATABASE_URL`.

---

## 5. Shell and security model (UI)

- **Shell** = host chrome: Activity Bar, topbar, sidebar, command palette, Extension Manager, HITL panel, auth gate.
- Extension **pages / sidebars / widgets** load in **sandboxed iframes**. Home (`dashboard`) stays in-process.
- Host ↔ iframe uses **Comlink** over a dedicated MessageChannel (no shared global channel — avoids cross-talk).
- Most of the app needs a login. Extensions can declare **public** UI/API paths (signed links, portals, webhooks) so outsiders can use a narrow surface without a full session (ticket **72**).
- UI controls come from **`@agentos/ui`**.

---

## 6. Data and multi-tenancy

1. User signs in → session can list **orgs** and an **active org**.
2. Almost every db-store document is stamped with **`org_id`**. Queries stay inside that org.
3. On Postgres, **row-level security** backs the same rule; SQLite uses strict filters in code.
4. Platform collections (HITL, audit, notifications, outbox, …) use a reserved platform org so builtins can store their own state.
5. **Secrets** are encrypted per org. **Vectors**, **files**, and **inbound email** follow the same org story.

This is what makes five future portfolio products safe to host on one deployment without mixing customer data.

---

## 7. Events, jobs, and AI workflows

- Publishing an event **writes to durable storage**, then fans out to live SSE subscribers in this process.
- Background workers **claim → ack / nack** with retries; poison messages go `dead` after enough failures.
- A **scheduler** runs cron or “run at” jobs (publish an event or hit an HTTP URL).
- Approving something in HITL emits **`hitl.resolved`** so other modules can react.
- The **ai** builtin can draft text, generate images, embed, call tools, and (with schema / file inputs) power structured extraction for things like COI PDFs.

Until you add shared Redis + a shared live bus, keep **replicas at 1** for Shell SSE. Durable queue consumers can already be multi-instance because leases live in db-store.

---

## 8. Local development

```bash
pnpm install          # workspace + Python uv sync on postinstall
bun run dev           # sample client-app via Turbo/Vite
bun run ci            # lint, format check, types, build, tests
```

What starts under the hood:

1. Vite (or later `agentos start`) loads the gateway.
2. Process manager starts builtin APIs on fixed ports and customer extension APIs/services from `meta.json`.
3. Browser hits the Shell; API calls go to `/api/ext/...` and are proxied to `127.0.0.1:<port>`.

Create a new app: `agentos create …` from `templates/`.

---

## 9. Production build (portable core)

AgentOS production is a **Docker image**, not “a Cloudflare app.” Cloud folders only **adapt** that image.

```text
┌────────────── portable artifact ──────────────┐
│  Root Dockerfile                              │
│    pnpm install → agentos build → prune       │
│    CMD: agentos start  →  Bun.serve :8080     │
│    Gateway + builtins + consumer sidecars     │
└─────────────────────┬─────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
  deploy/cloudflare  Cloud Run    ECS / EKS
  (Worker→Container) (future)     (future)
```

| Step            | What happens                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| **Build image** | Root `Dockerfile` (Bun + pnpm + uv). Default consumer `examples/client-app` (override `CONSUMER_PATH`). |
| **Start**       | `agentos start` spawns builtins + extensions, serves gateway + static `dist/` on **8080**.              |
| **Health**      | `GET /healthz` = gateway process is up (does not deep-check every child).                               |
| **Secrets**     | Runtime env / `--env-file` only — never bake `.env` into the image.                                     |

Optional: Playwright OS deps via `deploy/docker/Dockerfile.playwright.fragment` for headless **worker** images (not in the default image).

Same image should run on Cloudflare Containers, Cloud Run, ECS, or EKS — only the adapter changes.

---

## 10. Deployment today: Cloudflare

Folder: [`deploy/cloudflare`](../../deploy/cloudflare/README.md).

```text
Internet (HTTPS)
    → Cloudflare Worker (proxy only)
        → one Container running the portable image (agentos start :8080)
            → gateway
            → builtin + extension processes on loopback
```

| Piece                       | Role                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **Worker + Durable Object** | Terminate TLS, forward to the container, readiness via `/healthz`                    |
| **Container**               | Full AgentOS process tree                                                            |
| **Neon (Postgres)**         | Auth DB + db-store (and pgvector when used) — disk inside the container is ephemeral |
| **R2 (S3 API)**             | Durable files via `AGENT_OS_EXT_FILES_S3_*`                                          |
| **Redis (optional)**        | Shared cache-store before `max_instances` > 1                                        |
| **Email / SMS providers**   | Wired through notifications env (or log sink in staging)                             |

**Environments**

| Branch / trigger   | Worker                                                         | Notes                        |
| ------------------ | -------------------------------------------------------------- | ---------------------------- |
| Push to **`dev`**  | Staging `agentos` → `https://agentos.thatlad.workers.dev`      | After CI                     |
| Push to **`main`** | Production `agentos-demo` → `https://agentos-demo.thatlad.dev` | After CI                     |
| Pull requests      | **No** Cloudflare deploy                                       | Local Docker / wrangler only |

CI workflow: `.github/workflows/deploy-cloudflare.yml` (smoke → `pnpm run ci` → secrets check → deploy). Wrangler secrets are **per Worker** (production vs `--env dev`).

**Important:** `@cloudflare/*` stays under `deploy/cloudflare` only — never inside `packages/core` or builtins. Adapters inject env; they do not own product logic.

---

## 11. Env mental model

| Prefix                     | Meaning                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `AGENT_OS_GLOBAL_*`        | Platform / gateway / app origin                                       |
| `AGENT_OS_EXT_<BUILTIN>_*` | That builtin’s config (auth secret, DB URL, Redis, S3, SSO, email, …) |

Minimum production ideas:

- Strong `AGENT_OS_EXT_AUTH_SECRET` and public `AGENT_OS_GLOBAL_APP_ORIGIN` / auth base URL
- Postgres for auth + db-store (not SQLite on ephemeral disks)
- S3-compatible files for uploads that must survive restarts
- Redis before horizontal scale of cache-dependent features

Full checklist: [deploy/README.md](../../deploy/README.md).

---

## 12. What is done vs what is next

**Platform (≈ tickets 1–87):** Shell, gateway, CLI, sample app, production image, Cloudflare adapter, tenancy, public routes, email/SMS, durable events/scheduler, SSO/roles, richer db-store, secrets vault, OAuth/webhook kits, vector-store, workers, Redis cache, SDK parity, dual Bun+Python meta, AI structured/multimodal, inbound email, retention/subject delete.

**Still open / later**

| Item                                   | Notes                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Tickets **29**, **30**, **65**, **70** | E2E verification, Next host spike, live R2 smoke leftover, personal portfolio site |
| Tickets **88–92**                      | TrustDesk → ChannelGuard MVP consumer apps (not started)                           |
| Multi-replica live SSE                 | Durable queues OK; Shell live subscribe still process-local                        |

---

## 13. How to keep reading

| Doc                                                              | When                                         |
| ---------------------------------------------------------------- | -------------------------------------------- |
| [concepts.md](./concepts.md)                                     | Glossary and hard boundaries                 |
| [architecture.md](./architecture.md)                             | Deeper gateway / Comlink / SPA path rules    |
| [builtins.md](./builtins.md)                                     | Every builtin API and env var                |
| [extensions.md](./extensions.md) / [services.md](./services.md)  | How to author features                       |
| [packages.md](./packages.md)                                     | Package export map                           |
| [deploy/README.md](../../deploy/README.md)                       | Portable image + env                         |
| [deploy/cloudflare/README.md](../../deploy/cloudflare/README.md) | Current cloud adapter + CI                   |
| [portfolio-briefs.md](../portfolio/portfolio-briefs.md)          | Five products this platform is meant to host |

---

_Last aligned with platform work through ticket 87. Prefer updating this file when the portable deploy contract or the builtin set changes in a big way._
