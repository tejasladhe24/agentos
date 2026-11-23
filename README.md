# AgentOS

**The framework for building extensible products.**

Ship features as isolated **extensions** — UI, APIs, and AI tools — without forking your host app or hand-wiring registries. AgentOS gives you a production Shell, sandboxed feature surfaces, convention-based discovery, and platform builtins (auth, data, AI) so product teams move fast without each service holding the database keys.

[Documentation](.project/docs/README.md) · [Concepts](.project/docs/concepts.md) · [Architecture](.project/docs/architecture.md) · [Repository](https://github.com/tejasStarboard/agentos)

---

## Why AgentOS

Modern products need to grow by **feature modules**, not by growing a monolith. AgentOS is built for that shape:

| Need                      | What you get                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Isolated product features | Drop an `extensions/<id>/` folder — Shell and gateway discover it                      |
| Safe UI composition       | Extension views run in sandboxed iframes (Comlink); a crash doesn’t take down the host |
| Per-feature backends      | Bun file-based API routes **or** Python FastAPI services                               |
| Shared platform concerns  | Always-on builtins: auth + RBAC, db-store, cache-store, AI, HITL, and more             |
| Consistent product UI     | Shared primitives via `@agentos/ui` (shadcn + Tailwind)                                |
| Agent-ready workflows     | Skills and docs so coding agents plan against real boundaries                          |

**Who it’s for**

- **Product / FDE teams** building customer features as extensions and services
- **Platform engineers** owning the Shell, gateway, and builtins
- **Coding agents** implementing work against documented architecture

---

## How it fits together

```text
┌──────────────────────────── your product (consumer app) ─────────────────────┐
│  mountShell()           ←── @agentos/core                                    │
│  ui/dashboard.tsx       ←── app Home (in-process)                            │
│  extensions/<id>/       ←── product features (UI + agent + optional Bun API) │
│  services/<id>/         ←── Python backends when you need them               │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │  /api/ext/<id>/*
                                    ▼
┌──────────────────────────── AgentOS platform ────────────────────────────────┐
│  Shell · Gateway · Builtins · @agentos/ui                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Mental model in one line:** your app mounts the Shell; features live in extensions; heavy backends live in services; the platform owns auth, storage access, and AI.

---

## Quick start

**Requirements:** Node ≥ 24 (for pnpm; use `nvm use` with the repo `.nvmrc`), [pnpm](https://pnpm.io), [Bun](https://bun.sh), and [uv](https://github.com/astral-sh/uv) for Python services.

```bash
pnpm install
bun run dev          # sample app: Shell + builtins + CRM + invoice-bot
```

Open the local Vite URL, sign in with the demo admin (`admin@example.com` / `password123`), and explore the Activity Bar, extensions, and Approvals.

```bash
bun run ci           # lint · format · typecheck · build · test
```

Sample consumer app: [`examples/client-app`](examples/client-app/README.md).

---

## Packages

| Package                                                | Role                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`@agentos/core`](packages/core/README.md)             | Framework — Shell, Comlink SDK, Bun API kit, Vite gateway, builtins, `agentos` CLI |
| [`@agentos/ui`](packages/ui/README.md)                 | Shared React UI primitives (shadcn + Tailwind)                                     |
| [`agentos` (Python)](packages/python/README.md)        | SDK for `services/<id>/` FastAPI backends                                          |
| [`@agentos/client-app`](examples/client-app/README.md) | Reference product — mounts Shell, sample extensions & services                     |

Tooling: [`@agentos/typescript-config`](tooling/typescript-config) (shared TS configs).

---

## Core ideas

| Term             | Meaning                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Consumer app** | Your product. Owns Home (`ui/dashboard.tsx`), `extensions/`, and `services/`.                    |
| **Shell**        | Host chrome: Activity Bar, sidebar, main canvas, command palette, Extension Manager, HITL.       |
| **Extension**    | Feature unit — optional UI + agent decls + optional Bun API. Customer extensions are toggleable. |
| **Builtin**      | Platform extension (auth, stores, AI, …) — always on, not toggleable.                            |
| **Service**      | Standalone Python process under `services/<id>/`, linked from extension `meta.json`.             |
| **Gateway**      | HTTP edge that proxies `/api/ext/:id/*` and serves the registry.                                 |

**Hard boundaries (don’t cross these):**

- Extension **UI** imports `@agentos/core/client` (+ `@agentos/ui`) only — never the API kit
- Extension **APIs** import `@agentos/core/api/*` only — run with **Bun**, not Node
- **Python** backends live in `services/`, not inside `extensions/`
- Customer code does **not** hold `DATABASE_URL` — use builtin **db-store** / **cache-store**
- Auth + RBAC only via builtin **auth** and `@agentos/core/api/auth`

Full glossary: [`.project/docs/concepts.md`](.project/docs/concepts.md).

---

## Tooling

| Concern             | Tool                                                 |
| ------------------- | ---------------------------------------------------- |
| Workspace install   | **pnpm**                                             |
| Run TypeScript / JS | **Bun** (`bun run` / `bunx`) — not Node for services |
| Python services     | **uv** / uvicorn                                     |

Policy: [ADR 001 — pnpm + Bun hybrid](.project/docs/adr/001-pnpm-bun-hybrid.md).

---

## Documentation

| Doc                                                                                                                       | Contents                           |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [Docs index](.project/docs/README.md)                                                                                     | Full documentation map             |
| [Concepts](.project/docs/concepts.md)                                                                                     | Extension vs service vs packages   |
| [Architecture](.project/docs/architecture.md)                                                                             | System design                      |
| [Packages](.project/docs/packages.md)                                                                                     | Export map and module layout       |
| [Extensions](.project/docs/extensions.md) / [Services](.project/docs/services.md) / [Builtins](.project/docs/builtins.md) | How to build each layer            |
| [Cookbooks](.project/docs/cookbook/)                                                                                      | Add an extension or Python service |
| [ADRs](.project/docs/adr/)                                                                                                | Architecture decisions             |
| [`AGENTS.md`](AGENTS.md)                                                                                                  | Rules for coding agents            |

---

## Contributing

Work is tracked in [`.project/tickets/`](.project/tickets/). Integration lands on **`dev`** via pull requests ([git workflow](.agents/skills/agentos-git-workflow/SKILL.md)).

Coding agents should load:

- `.agents/skills/agentos-architecture`
- `.agents/skills/agentos-ticket-planner`
- `.agents/skills/agentos-bun-runtime`

Details: [`.project/docs/skills.md`](.project/docs/skills.md).
