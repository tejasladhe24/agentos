# Built-in extensions

Shipped in `packages/core/builtins/`. Registry flags: `kind: "builtin"`, `driven: true`, `toggleable: false`.

## Driving (required)

| Id              | Role                                                                                                                                                                                                                                                              | Tech                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **auth**        | Identity, sessions, **RBAC**; public gate at `/login` `/register` `/reset-password`; Activity Bar **secondary** `ui/page.tsx` + `ui/sidebar.tsx` = **account settings** (sidebar nav → profile / roles / security / session) — distinct from builtin **settings** | Better Auth (+ db-store as needed)                                     |
| **db-store**    | Sole SQL owner                                                                                                                                                                                                                                                    | Drizzle (SQLite default)                                               |
| **cache-store** | Sole cache owner                                                                                                                                                                                                                                                  | In-memory v1                                                           |
| **ai**          | generateText/Image/embed, tools/skills/agents runtime                                                                                                                                                                                                             | Vercel AI SDK v7 (mock default; [ADR 006](./adr/006-vercel-ai-sdk.md)) |

## Supporting (default-on)

| Id                | Role                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **hitl**          | Approvals API; Activity Bar **secondary** opens HITL panel in left sidebar (no `ui/`)                                          |
| **settings**      | App/platform preferences; Activity Bar **secondary** (`GearSix`) opens `ui/page.tsx` (distinct from Auth **account** settings) |
| **events**        | Cross-extension pub/sub                                                                                                        |
| **files**         | Blob/object API                                                                                                                |
| **notifications** | Toast/fan-out                                                                                                                  |
| **secrets**       | Secret resolution                                                                                                              |
| **audit**         | Append-only audit via db-store                                                                                                 |

## Access pattern

Customer (and most) APIs call builtins through `@agentos/core/api/*` or `agentos.*` — never hold `DATABASE_URL` themselves.

Extension Manager shows builtins as **locked**.

## Auth production env

Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`.

| Variable                                 | Production                       | Notes                                                                                           |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AGENT_OS_EXT_AUTH_SECRET`               | **Required** (≥32 chars)         | No default; must not be the local dev secret                                                    |
| `AGENT_OS_GLOBAL_APP_ORIGIN`             | **Required** for HTTPS Shell     | e.g. `https://app.example.com` — trustedOrigins + secure cookies + reset links                  |
| `AGENT_OS_EXT_AUTH_BASE_URL`             | **Required** for public auth URL | Better Auth `baseURL` as seen by the browser / gateway                                          |
| `AGENT_OS_GLOBAL_NODE_ENV` or `NODE_ENV` | `production`                     | Disables demo admin/viewer seed; requires real secret                                           |
| `AGENT_OS_EXT_AUTH_SEED_DEMO`            | Optional `true`/`false`          | Override seed default (`false` in production, `true` otherwise)                                 |
| `AGENT_OS_EXT_AUTH_DB`                   | Optional                         | SQLite path (default `~/.agentos/store/auth.sqlite`) **or** `postgres://` / `postgresql://` URL |

When `AGENT_OS_GLOBAL_APP_ORIGIN` or `AGENT_OS_EXT_AUTH_BASE_URL` is `https:`, auth sets `useSecureCookies` and `Secure` cookie attributes.

**Production storage:** prefer managed Postgres (Neon / RDS / Cloud SQL) via `AGENT_OS_EXT_AUTH_DB`. Same single env key as local SQLite — do not set a customer `DATABASE_URL`. Auth (like db-store’s `AGENT_OS_EXT_DB_STORE_DATABASE_URL`) is one of the only builtins allowed to hold SQL credentials ([ADR 004](./adr/004-db-store-sole-sql-owner.md)). On Neon, prefer the **direct** (non-pooler) host for startup migrations.
