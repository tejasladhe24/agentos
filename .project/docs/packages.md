# Packages

## `@agentos/core` (TypeScript)

Framework package. Parent exports:

| Export                            | Who                 | Responsibility                                                                   |
| --------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `@agentos/core`                   | App `main.tsx`      | `mountShell()`, shared types                                                     |
| `@agentos/core/config`            | `agentos.config.ts` | `defineConfig` — auth, branding, builtins (not secrets)                          |
| `@agentos/core/client`            | `ui/*.tsx` only     | `HostProvider` + `useHost*` (never `api/routes`)                                 |
| `@agentos/core/api`               | `api/routes/**`     | `createApp`, `loadRoutes`                                                        |
| `@agentos/core/api/env`           | App / Bun APIs      | `platformKeys` + naming helpers (`AGENT_OS_GLOBAL_*`)                            |
| `@agentos/core/api/auth`          | API routes          | Session + RBAC (Better Auth)                                                     |
| `@agentos/core/api/store`         | API routes          | `dbStore`, `cacheStore` clients                                                  |
| `@agentos/core/api/vector-store`  | API routes          | Org-scoped embedding upsert / similarity query (pgvector)                        |
| `@agentos/core/api/secrets`       | API routes          | Env + per-org vault (`listSecrets` / `getSecret` / `putSecret` / `deleteSecret`) |
| `@agentos/core/api/files`         | API routes          | Blob put/get/delete (`putBlob` / `getBlob` / `deleteBlob`)                       |
| `@agentos/core/api/events`        | API routes          | Publish, SSE subscribe URL, outbox claim/ack, scheduled jobs                     |
| `@agentos/core/api/audit`         | API routes          | Append-only audit entries (`appendEntry` / `listEntries`)                        |
| `@agentos/core/api/notifications` | API routes          | Notify + recent inbox + delivery status                                          |
| `@agentos/core/api/oauth`         | API routes          | Provider-agnostic OAuth state, authorize URL, code exchange, vault tokens        |
| `@agentos/core/api/webhook`       | API routes          | Inbound HMAC verify, timestamp skew, idempotency                                 |
| `@agentos/core/api/ai`            | API routes          | AI client (`generateText` + optional JSON Schema / files)                        |
| `@agentos/core/api/hitl` …        | API routes          | Other builtin clients                                                            |
| `@agentos/core/gateway`           | Hosts / CLI         | Portable fetch handlers (`/_public`, `/api/ext`, agent, HTML)                    |
| `@agentos/core/gateway/*`         | Framework           | Deep gateway modules                                                             |
| `@agentos/core/vite`              | `vite.config.ts`    | Scanner, virtual modules, Connect adapter over gateway                           |
| `@agentos/core/vite/*`            | Framework           | Deep vite modules (`lib/types`, …)                                               |
| `@agentos/core/sdk`               | Advanced            | Low-level Comlink                                                                |
| `@agentos/core/shell`             | Framework           | `mountShell`                                                                     |
| `@agentos/core/shell/*`           | Framework           | Shell `lib` / `hooks` / `components`                                             |
| `@agentos/core/client/*`          | Framework           | Deep client modules                                                              |
| `@agentos/core/agent`             | Framework           | Agent registry helpers                                                           |
| `@agentos/core/builtins/*`        | Framework           | Builtin APIs / env (`auth/env`, `auth/api/lib/…`)                                |
| `agentos` CLI                     | Scripts             | `dev` / `build` / `start` (prod: static `dist/` + gateway on PORT/8080)          |

**Container:** root [`Dockerfile`](../../Dockerfile) runs `agentos build` then `agentos start` for `examples/client-app` on port 8080. Local verify and `--platform` notes: [architecture.md — Container image](./architecture.md#container-image).

Prefer `@agentos/core/...` aliases over `../` relative imports inside the core package.

Module layout (every `packages/core/src/<module>/` and app packages):

```text
<module>/
  index.ts            # public/internal barrel
  components/         # React UI (when applicable)
  lib/                # implementation (non-UI helpers, stores, stubs)
  tests/              # bun:test suites
```

Examples: `shell/` (components + lib + tests), `sdk/` (lib + tests), `api/` (`lib/auth.ts` → `@agentos/core/api/auth`). File names stay kebab-case.

## `@agentos/ui` (TypeScript)

Shared **shadcn + Tailwind** primitives for Shell, builtins, and extension UI.

| Export                     | Who                | Responsibility                         |
| -------------------------- | ------------------ | -------------------------------------- |
| `@agentos/ui/components/*` | Shell / `ui/*.tsx` | Button, Input, Select, Dialog, …       |
| `@agentos/ui/lib/utils`    | Same               | `cn()` class merge                     |
| `@agentos/ui/hooks/*`      | Same               | Shared UI hooks                        |
| `@agentos/ui/globals.css`  | App / Shell entry  | Tailwind + design tokens (import once) |

**Rule:** use these components for base controls by default. Do not drop native `<button>` / `<input>` / `<select>` unless specifically required. See `.cursor/rules/agentos-ui.mdc`.

**File names:** kebab-case everywhere (`button.tsx`, `scroll-area.tsx`, `activity-bar.tsx`).

## `agentos` (Python)

Separate pip/uv package under [`packages/python`](../../packages/python) (see package [README](../../packages/python/README.md)). Mirrors `/api` domains for `services/<id>/` only — never under `extensions/`.

### Domain → import path (TS + Python)

| Domain        | Bun / API routes                  | Python service          |
| ------------- | --------------------------------- | ----------------------- |
| auth          | `@agentos/core/api/auth`          | `agentos.auth`          |
| store         | `@agentos/core/api/store`         | `agentos.store`         |
| ai            | `@agentos/core/api/ai`            | `agentos.ai`            |
| hitl          | `@agentos/core/api/hitl`          | `agentos.hitl`          |
| files         | `@agentos/core/api/files`         | `agentos.files`         |
| events        | `@agentos/core/api/events`        | `agentos.events`        |
| audit         | `@agentos/core/api/audit`         | `agentos.audit`         |
| secrets       | `@agentos/core/api/secrets`       | `agentos.secrets`       |
| notifications | `@agentos/core/api/notifications` | `agentos.notifications` |
| oauth         | `@agentos/core/api/oauth`         | `agentos.oauth`         |
| webhook       | `@agentos/core/api/webhook`       | `agentos.webhook`       |
| vector-store  | `@agentos/core/api/vector-store`  | `agentos.vector_store`  |

## Consumer

`examples/client-app` — depends on `@agentos/core`, owns app-level `ui/dashboard.tsx` (Home), `extensions/`, and optionally `services/`.

## Tooling

- Install: `pnpm install` at repo root.
- Run TS: `bun run` / `bun ./path.ts`.
- Never: `node server.js` for platform APIs.
