# Cloudflare adapter (`deploy/cloudflare`)

Thin Worker that proxies HTTPS to a single [Cloudflare Container](https://developers.cloudflare.com/containers/) running the portable AgentOS image (`agentos start` on **8080**). No domain logic — delete this folder when migrating to Cloud Run / ECS / EKS.

See the portable env checklist in [`../README.md`](../README.md).

## Prerequisites

| Requirement                  | Why                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| **Workers Paid** plan        | Containers require a paid Workers plan                                                     |
| Docker running locally       | `wrangler deploy` builds/pushes the image from the repo-root `Dockerfile`                  |
| **R2** bucket + S3 API token | Durable files (`AGENT_OS_EXT_FILES_S3_*`)                                                  |
| **Neon** (or other Postgres) | Auth + db-store survive ephemeral container disks                                          |
| Custom domain (recommended)  | Set `AGENT_OS_GLOBAL_APP_ORIGIN` / `AGENT_OS_EXT_AUTH_BASE_URL` to the public HTTPS origin |

Optional before multi-instance: tickets **60** / **61**. This adapter pins `max_instances: 1`.

## Layout

| File                 | Role                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `wrangler.jsonc`     | Container + Durable Object binding; `max_instances: 1`; image = repo-root `Dockerfile` |
| `worker.ts`          | Proxy-only Durable Object (`ctx.container`); readiness via `GET /healthz`              |
| `lib/forward-env.ts` | Forwards Worker vars/secrets into the container on start                               |

`@cloudflare/*` stays **here only** — never under `packages/core` or builtins. The deprecated `@cloudflare/containers` package is **not** used; Worker code uses the Durable Object Container API.

## Install & deploy

From the monorepo root (after `pnpm install`):

```bash
# Set secrets (examples — match deploy/README.md checklist)
cd deploy/cloudflare
pnpm exec wrangler secret put AGENT_OS_EXT_AUTH_SECRET
pnpm exec wrangler secret put AGENT_OS_EXT_AUTH_DB
pnpm exec wrangler secret put AGENT_OS_EXT_DB_STORE_DATABASE_URL
pnpm exec wrangler secret put AGENT_OS_EXT_FILES_S3_ACCESS_KEY_ID
pnpm exec wrangler secret put AGENT_OS_EXT_FILES_S3_SECRET_ACCESS_KEY

# Non-secrets: edit wrangler.jsonc `vars` (app origin, R2 bucket/endpoint/region)

pnpm deploy
# or from repo root:
# pnpm deploy:cloudflare
```

First deploy builds the full monorepo image — expect several minutes. After the Worker URL responds, wait for container provisioning before `/healthz` succeeds.

## CI deploy (GitHub Actions)

Workflow: [`.github/workflows/deploy-cloudflare.yml`](../../.github/workflows/deploy-cloudflare.yml).

| Trigger                           | Behavior                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Push to **`main`**                | Install → `pnpm ci` → fail-closed secret check → `pnpm deploy:cloudflare`                                     |
| **`workflow_dispatch`**           | Same path (manual re-deploy)                                                                                  |
| Pull requests / push to **`dev`** | **No** Cloudflare deploy (verification stays on [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) |

### Preview / staging policy

- **PRs:** never deploy to Cloudflare. Use local `wrangler` / Docker if you need an adapter smoke before merge.
- **`dev`:** integration only; no staging Worker in v1 (add a Wrangler `env` later if needed).
- **`main`:** production Worker (`name: agentos` in `wrangler.jsonc`).

### Required GitHub secrets

Repository **Settings → Secrets and variables → Actions**:

| Secret                  | Purpose                       |
| ----------------------- | ----------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Non-interactive Wrangler auth |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account     |

If either secret is missing on `main` / `workflow_dispatch`, the job **exits 1** (fail closed) — it does not skip deploy silently.

### API token permissions

Create a custom token (or start from **Edit Cloudflare Workers**) scoped to the deploy account:

| Permission                   | Access                            |
| ---------------------------- | --------------------------------- |
| Account → Workers Scripts    | Edit                              |
| Account → Workers Containers | Edit (image push + container app) |
| Account → Account Settings   | Read (account id / plan checks)   |

Workers **Paid** is required for Containers. App secrets (`AGENT_OS_EXT_*`) stay in Wrangler secrets / `vars` — they are **not** GitHub Actions secrets for this workflow.

### Image build duration / caching

`wrangler deploy` builds the monorepo image from the root `Dockerfile` (context = repo root) and pushes it to Cloudflare’s container registry. Budget **several minutes** on first or cold CI runs (`timeout-minutes: 60` on the job). GHA does not cache the Docker layers across runs by default; expect full rebuild cost when the Dockerfile or install graph changes. Runner Docker (ubuntu-latest) must be available — Wrangler needs the daemon during deploy.

## Local secrets

Copy [`.dev.vars.example`](./.dev.vars.example) → `.dev.vars` (gitignored) for `wrangler dev`. Do not commit real secrets.

```bash
pnpm --filter @agentos/deploy-cloudflare dev
```

## Custom domain

1. Attach a custom domain to the Worker in the Cloudflare dashboard (or via Wrangler routes).
2. Set `AGENT_OS_GLOBAL_APP_ORIGIN` and `AGENT_OS_EXT_AUTH_BASE_URL` to `https://<that-host>` (vars or secrets).
3. Redeploy so a fresh container start picks up the new env.

## Migrate off Cloudflare

1. Stop using / delete `deploy/cloudflare/`.
2. Push the **same** root `Dockerfile` image to your registry.
3. Run it behind Cloud Run, ALB + Fargate, or Ingress + EKS on port **8080** with the portable env checklist.
