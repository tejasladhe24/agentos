# Deploy — portable runbook

AgentOS production is a **container image**, not a Cloudflare app. Cloud-specific files under `deploy/<cloud>/` are thin adapters that mount or proxy the same process. Migration between hosts = new manifests, not a rewrite.

## Portable core vs adapters

```text
┌──────────────────── portable artifact ────────────────────┐
│  Root Dockerfile → agentos start → Bun.serve :8080         │
│  @agentos/core/gateway (host-agnostic fetch handlers)     │
│  builtins + consumer extensions as sidecars on loopback   │
└───────────────────────────────┬───────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
   deploy/cloudflare/     deploy/gcp/            deploy/k8s/
   (Worker → Container)   (Cloud Run)            (Ingress/ECS)
```

| Layer             | What it is                                   | Where                                                       |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------- |
| **Portable core** | Image + `agentos start` + gateway handlers   | Root [`Dockerfile`](../Dockerfile), `@agentos/core/gateway` |
| **Adapter**       | Proxy, load balancer, or orchestrator wiring | `deploy/<cloud>/` only                                      |

Adapters must not import into `packages/core` or builtins. Cloudflare tooling stays out of the image.

## Image contract

- **Build:** root [`Dockerfile`](../Dockerfile) — Bun + pnpm + uv/Python; `agentos build` for the consumer; pruned runtime.
- **Browser workers:** optional [`docker/Dockerfile.playwright.fragment`](./docker/Dockerfile.playwright.fragment) for Playwright OS deps (not in the default image). See [services.md](../.project/docs/services.md#headless-browser-image).
- **Platform:** match the target CPU (`docker build --platform linux/amd64` or `linux/arm64`).
- **Consumer:** default `CONSUMER_PATH=examples/client-app`; override with `--build-arg CONSUMER_PATH=…`.
- **Listen:** `PORT` default **8080** (`EXPOSE 8080`).
- **Health:** `GET /healthz` — gateway process up (does not probe child APIs).
- **CMD:** `agentos start` (after build). Secrets via runtime env / `--env-file` — **never** bake `.env` into the image.

```bash
docker build --platform linux/amd64 -t agentos:local .
docker run --rm -p 8080:8080 --env-file .env.docker agentos:local
curl -sS http://127.0.0.1:8080/healthz
```

Same image runs on Cloudflare Containers, Cloud Run, ECS Fargate, and EKS.

## Env checklist

Pass these into the container. Naming: `AGENT_OS_GLOBAL_*` (platform), `AGENT_OS_EXT_<DOMAIN>_*` (extensions). Details also live in [builtins.md](../.project/docs/builtins.md).

### Gateway / app origin

| Variable                      | Role                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PORT`                        | Gateway listen port (default `8080`)                                                                  |
| `AGENT_OS_GLOBAL_APP_ORIGIN`  | Public HTTPS origin of the Shell (trustedOrigins, secure cookies, reset links)                        |
| `AGENT_OS_EXT_AUTH_BASE_URL`  | Better Auth `baseURL` as seen by the browser / gateway                                                |
| `AGENT_OS_GLOBAL_GATEWAY_URL` | **Set by `agentos start`** to `http://127.0.0.1:<port>` — do not rely on injecting this from the host |

### Auth

| Variable                                 | Production                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_OS_EXT_AUTH_SECRET`               | **Required** (≥32 chars; not the local dev secret)                                                                                 |
| `AGENT_OS_EXT_AUTH_DB`                   | Prefer `postgres://` / `postgresql://` (Neon / RDS / Cloud SQL). SQLite path is local-dev only — ephemeral container disks lose it |
| `AGENT_OS_GLOBAL_NODE_ENV` or `NODE_ENV` | `production` (image sets both)                                                                                                     |
| `AGENT_OS_EXT_AUTH_SEED_DEMO`            | Optional; default off in production                                                                                                |

Do **not** set a customer `DATABASE_URL`. Auth owns `AGENT_OS_EXT_AUTH_DB` only ([ADR 004](../.project/docs/adr/004-db-store-sole-sql-owner.md)).

### db-store

| Variable                             | Role                                                          |
| ------------------------------------ | ------------------------------------------------------------- |
| `AGENT_OS_EXT_DB_STORE_DATABASE_URL` | Postgres URL (or file path) for platform SQL via `/api/store` |
| `AGENT_OS_EXT_DB_STORE_PATH`         | Optional local SQLite path when not using a URL               |

Again: **no** customer `DATABASE_URL`. Extensions use `dbStore` / cache-store, not raw SQL credentials.

### cache-store

| Variable                             | Role                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` | Optional. When set, shared Redis (`redis://` / `rediss://`) for get/set/del. Omit → in-memory |
| `AGENT_OS_EXT_CACHE_STORE_PORT`      | Upstream port (default `6112`)                                                                |

Set the Redis URL before raising `max_instances` / replicas above **1** when replicas must share permission caches, rate limits, or page fingerprints. Health reports `backend: "memory" | "redis"`.

### Files (S3-compatible)

On ephemeral disks, local filesystem storage is not durable. Set the S3-compatible vars (works with **R2**, **AWS S3**, **GCS** HMAC):

| Variable                                  | Role                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `AGENT_OS_EXT_FILES_S3_BUCKET`            | Enables S3 backend                                                     |
| `AGENT_OS_EXT_FILES_S3_ENDPOINT`          | Required for R2 / GCS / MinIO; optional for AWS                        |
| `AGENT_OS_EXT_FILES_S3_REGION`            | e.g. `auto` (R2) or `us-east-1`                                        |
| `AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID`     | Access key                                                             |
| `AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY` | Secret key                                                             |
| `AGENT_OS_EXT_FILES_S3_SESSION_TOKEN`     | Optional                                                               |
| `AGENT_OS_EXT_FILES_PATH`                 | Local root only — ignored when bucket is set; avoid in prod containers |

Do **not** import Cloudflare R2 bindings into `@agentos/core` — inject credentials as env only.

### AI

| Variable                              | Role                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_OS_EXT_AI_PROVIDER`            | `openai` / `anthropic` / `google` / `ai-gateway`; **unset → mock** models ([ADR 006](../.project/docs/adr/006-vercel-ai-sdk.md)) |
| `AGENT_OS_EXT_AI_API_KEY`             | Provider API key (secret)                                                                                                        |
| `AGENT_OS_EXT_AI_MODEL`               | Language model id (required with a provider)                                                                                     |
| `AGENT_OS_EXT_AI_EMBEDDING_MODEL`     | Optional embedding model                                                                                                         |
| `AGENT_OS_EXT_AI_IMAGE_MODEL`         | Optional image model                                                                                                             |
| `AGENT_OS_EXT_AI_BASE_URL`            | Optional provider base URL (regional / proxy)                                                                                    |
| `AGENT_OS_EXT_AI_ZERO_DATA_RETENTION` | `ai-gateway` only: restrict to zero-data-retention providers                                                                     |
| `AGENT_OS_EXT_AI_GATEWAY_URL`         | Gateway URL for the AI builtin (defaults for in-container loopback)                                                              |

Full semantics: [builtins.md › AI env](../.project/docs/builtins.md#ai-env).

## Non-goals

- **No** Cloudflare D1, KV, or Durable Objects for application state — durable data goes through auth Postgres, db-store, and S3-compatible files.
- **No** `@cloudflare/*` (or other cloud SDKs) under `packages/core` or builtins.
- **No** Wrangler / Workers tooling baked into the production image.
- This runbook is **container deploy**, not the Next host spike (ticket 30).

## Cloudflare adapter

Thin disposable Worker under [`cloudflare/`](./cloudflare/). It proxies HTTPS to one Container that runs this image on **8080**. Details: [`cloudflare/README.md`](./cloudflare/README.md).

| Prerequisite           | Notes                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workers Paid**       | Containers are not available on the free Workers plan                                                                                        |
| **R2** bucket          | Create a bucket + S3 API credentials; set `AGENT_OS_EXT_FILES_S3_*` (endpoint `https://<accountid>.r2.cloudflarestorage.com`, region `auto`) |
| **Neon** (or Postgres) | Set `AGENT_OS_EXT_AUTH_DB` and `AGENT_OS_EXT_DB_STORE_DATABASE_URL` (prefer Neon **direct** host for auth migrations)                        |
| **Custom domain**      | Attach to the Worker; set `AGENT_OS_GLOBAL_APP_ORIGIN` and `AGENT_OS_EXT_AUTH_BASE_URL` to that HTTPS origin                                 |

```bash
pnpm install
# secrets: cd deploy/cloudflare && pnpm exec wrangler secret put …
pnpm deploy:cloudflare          # production Worker `agentos`
pnpm deploy:cloudflare:dev      # staging Worker `agentos` (--env dev)
```

Image path in `wrangler.jsonc`: `../../Dockerfile` with `image_build_context: ../..` (monorepo root). First deploy builds the full image — expect several minutes. Keep `max_instances: 1` until shared cache is configured (`AGENT_OS_EXT_CACHE_STORE_REDIS_URL`) and live events SSE fanout is acceptable process-local (or a later pub/sub lands).

**CI:** [`.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml) — push to **`main`** → production; push to **`dev`** (post-merge) → staging (`--env dev`). Requires GitHub secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (fail closed if missing). PRs do **not** deploy — see [`cloudflare/README.md`](./cloudflare/README.md) (CI deploy).

Do **not** put Cloudflare R2 bindings or `@cloudflare/*` into `packages/core` — only inject credentials as container env.

## Migrate off Cloudflare

1. Stop using (or delete) `deploy/cloudflare/`.
2. Push the **same** image to your registry.
3. Run it behind Cloud Run, ALB + ECS Fargate, or Ingress + EKS — listen on **8080**, forward the env checklist above.
4. Point DNS / TLS at the new front door; app origin and auth base URL stay the public HTTPS URLs.

No gateway rewrite; adapters are disposable.

## Layout

| Path                 | Status                                                                     |
| -------------------- | -------------------------------------------------------------------------- |
| `deploy/README.md`   | This runbook                                                               |
| `deploy/cloudflare/` | Thin Worker + Containers adapter (`pnpm deploy:cloudflare`)                |
| `deploy/k8s/`        | **Placeholder** — future Ingress / ECS / EKS manifests (out of scope here) |
| `deploy/gcp/`        | **Placeholder** — future Cloud Run manifests (out of scope here)           |

Do not put domain logic in adapters. See [architecture.md](../.project/docs/architecture.md) (Container image) and [concepts.md](../.project/docs/concepts.md) (gateway host-agnostic).
