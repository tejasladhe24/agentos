# Concepts & boundaries

Short definitions so humans and agents never confuse **extension**, **service**, and **packages**.

## Glossary

| Term                        | What it is                                                              | Where it lives                                         | What it is _not_                                        |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| **App / consumer**          | Product that mounts the Shell and owns customer features                | `examples/client-app/`                                 | Not `@agentos/core` itself                              |
| **Shell**                   | Host UI: slots, iframes, Cmd+K, Extension Manager, chat/HITL chrome     | `@agentos/core` `shell/`, via `mountShell()`           | Not an extension; no domain business logic              |
| **Gateway**                 | HTTP edge: registry, `/api/ext/:id/*` proxy, agent entrypoints          | `@agentos/core/gateway` fetch handlers (host-agnostic) | Not domain CRUD                                         |
| **Extension**               | Feature unit: optional UI + agent decls + optional TS API routes        | `extensions/<id>/` or `packages/core/builtins/<id>/`   | Not the Python process                                  |
| **Builtin extension**       | Platform extension, always on, not toggleable                           | `packages/core/builtins/<id>/`                         | Not copied into customer `extensions/` to “enable auth” |
| **Customer extension**      | Product feature (CRM, invoices, …), toggleable                          | `examples/.../extensions/<id>/`                        | Must not open DB/cache directly                         |
| **API (TS / Bun)**          | File-based HTTP routes via `createApp` / `loadRoutes`, run with **Bun** | `extensions/<id>/api` (`server.ts` + `routes/**`)      | Not React UI; not Python; not run with Node             |
| **Service**                 | Standalone **Python** backend process                                   | `services/<id>/`                                       | Not under `extensions/<id>/`                            |
| **BFF**                     | Informal name for API _or_ service                                      | Prefer saying **API** or **service**                   | —                                                       |
| **`@agentos/core`**         | Framework: Shell, CLI, builtins, kits                                   | `packages/core`                                        | Not the customer app                                    |
| **`@agentos/core/client`**  | SDK for extension **UI** (iframes)                                      | Import in `ui/*.tsx`                                   | Never in `api/routes` or Python                         |
| **`@agentos/ui`**           | Shared shadcn + Tailwind primitives (Button, Input, Select, …)          | `packages/ui`                                          | Not a place for domain business logic                   |
| **`@agentos/core/api/*`**   | SDK for TS **API** routes                                               | Import in `api/routes/**`                              | Never in iframe UI                                      |
| **`@agentos/core/gateway`** | Portable `(Request) => Response \| null` HTTP edge                      | `agentos start` / any host                             | Not Vite- or Cloudflare-specific                        |
| **`@agentos/core/vite`**    | Vite plugin + Connect adapter over gateway                              | `vite.config.ts`                                       | Not the production gateway core                         |
| **`agentos` (Python)**      | SDK for Python services                                                 | `services/<id>/`                                       | Not a subpath of `@agentos/core`                        |
| **Agent folder**            | tools / skills / instructions declarations                              | `extensions/<id>/agent/`                               | Runtime is builtin `ai`                                 |
| **Tool**                    | Named HTTP-backed callable                                              | Declared in `agent/`, implemented on API/service       | Not an in-process Vite function                         |

## Mental model

```text
┌──────────────────────────── consumer app ────────────────────────────┐
│  mountShell()  ←── @agentos/core                                     │
│  vite.config   ←── @agentos/core/vite                                │
│                                                                      │
│  ui/dashboard.tsx          ←── APP Home surface (in-process)         │
│  ui/dashboard-sidebar.tsx  ←── APP Home sidebar (in-process)         │
│                                                                      │
│  extensions/<id>/          ←── EXTENSION                             │
│    ui/*.tsx                ←── @agentos/core/client + @agentos/ui    │
│    agent/*                 ←── declarations for builtin ai           │
│    api/routes/**           ←── @agentos/core/api/*  (Bun)            │
│    meta.json               ←── Bun api and/or linked Python service  │
│                                                                      │
│  services/<id>/            ←── SERVICE (Python)                      │
│    app/                    ←── agentos.*                             │
└──────────────────────────────────────────────────────────────────────┘
         │  /api/ext/<id>/*
         ▼
┌──────────────────────────── @agentos/core + @agentos/ui ─────────────┐
│  Shell + Gateway + builtins + shadcn primitives                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Rules of thumb

1. **UI SDK** → `@agentos/core/client` only. Never `@agentos/core/api` in `ui/`.
2. **UI primitives** → `@agentos/ui` (shadcn) for buttons, inputs, checkboxes, selects, dropdowns, etc. Avoid native HTML controls unless specifically required.
3. **TS routes** → `@agentos/core/api/*` only. No customer product DB URL / Redis — use `/api/store` (db-store may use `AGENT_OS_EXT_DB_STORE_DATABASE_URL` internally only).
4. **Python** → `agentos.*` in `services/` only, linked from `meta.json` (`api.language: "python"` **or** dual `service` beside a Bun `api` — ticket 83).
5. **Auth/RBAC** → builtin `auth` + `@agentos/core/api/auth` (no second stack; no `/api/rbac`). Public sign-in/up/reset are **Shell gate** routes (`/login`, `/register`, `/forgot-password`, `/reset-password`); Auth secondary Activity Bar is **account settings** (profile / **organization** / roles / security / sign-out), not app Settings. Session exposes **`orgId`** (active tenant) plus membership list; use `requireOrg()` when FDE routes need a tenant. **SSO** (OIDC/SAML) via Better Auth `@better-auth/sso` — email/password remains; role admin APIs under `/api/ext/auth/roles` and `/orgs/members` (permission `auth.roles.manage`). **Public extension portals** (trust center / client links) are declared in `meta.json` `public` — Shell admits those SPA paths without login; Bun APIs use short-lived signed tokens (`@agentos/core/api/public-token`) bound to `orgId` with a limited `role` (default `external_viewer`), not anonymous open access. See [extensions.md](./extensions.md#public-unauthenticated-routes).
6. **Tenancy** → orgs live in builtin `auth` (`organizations` / `org_members` / `user_active_org`). **db-store** stamps and filters every tenant document by `org_id` (row-per-tenant, not DB-per-tenant). Pass `orgId` via `dbStore.collection(name, { orgId })` or forward the auth cookie; platform collections (`agentos_gateway`, hitl/audit/notifications/events outbox+jobs) use sentinel `__platform__`.
7. **App config** → consumer-root `agentos.config.ts` via `@agentos/core/config` (`defineConfig`). Holds FDE settings including **auth** flags and **branding** (`appName`, `logoUrl`, `faviconUrl`, fonts). Consumer `public/` assets are served at `/_public/<path>` by the gateway — use those URLs (or `https://…`) in branding, never filesystem paths. Secrets stay in `src/env.ts` / `createEnv` (never in branding).
8. **SQL/cache/vectors** → `dbStore` / `cacheStore` / `vector-store` → builtins only (customers never hold `DATABASE_URL`).
9. **TS backend** stays in the extension (`api/`). **Python backend** is a **service**.
10. **Builtins** locked; **customer** extensions toggleable.
11. **pnpm** installs the monorepo; **Bun** runs all TS/JS. Never Node for services.
12. **Env** → each extension exports `keys = () => createEnv(...)`; the app calls `createEnv({ extends: [keys(), ...] })`. Naming: `AGENT_OS_GLOBAL_*` (platform), `AGENT_OS_EXT_<DOMAIN>_*` (extensions). Helpers live in `@agentos/core/api/env`.
13. **Bun API kit** → `@agentos/core/api` (`createApp`, `loadRoutes`) wires `extensions/<id>/api/server.ts` + `api/routes/**/index.ts` (`[param]` → `:param`). Built-in `GET /health` → `{ ok: true }`. Domain clients (`auth`, `store`, …) live under `@agentos/core/api/*`.

## Prefer these words

| Say                     | Avoid                                              |
| ----------------------- | -------------------------------------------------- |
| extension API / Bun API | “the Node BFF”                                     |
| service                 | “Python extension folder”                          |
| builtin `auth`          | “rbac package” as separate builtin                 |
| `agentos.config.ts`     | stuffing secrets into the Vite plugin              |
| `db-store`              | “give the CRM service a database URL”              |
| secrets vault / env     | raw tokens in db-store docs or `agentos.config.ts` |
| `@agentos/ui` Button    | raw `<button>` / ad-hoc button CSS                 |
