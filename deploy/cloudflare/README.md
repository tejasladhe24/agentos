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
# pnpm deploy:cloudflare          # production (top-level)
# pnpm deploy:cloudflare:dev      # staging (--env dev → Worker `agentos`)
```

First deploy builds the full monorepo image — expect several minutes. After the Worker URL responds, wait for container provisioning before `/healthz` succeeds.

## CI deploy (GitHub Actions)

Workflow: [`.github/workflows/deploy-cloudflare.yml`](../../.github/workflows/deploy-cloudflare.yml).

| Trigger                 | Behavior                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Push to **`main`**      | Workflow smoke → `pnpm run ci` → fail-closed secret check → `pnpm run deploy:cloudflare` (production `agentos-demo`) |
| Push to **`dev`**       | Same, then `pnpm run deploy:cloudflare:dev` → Wrangler `--env dev` (staging Worker `agentos`)                        |
| **`workflow_dispatch`** | Choose `production` or `dev`                                                                                         |
| Pull requests           | **No** Cloudflare deploy; PR CI runs deploy-workflow smoke (catches `pnpm ci` vs `pnpm run ci`, missing scripts)     |

Always use `pnpm run <script>` in the deploy workflow — bare `pnpm ci` is a pnpm builtin and does **not** run the repo `ci` script (`ERR_PNPM_CI_NOT_IMPLEMENTED`). Local check: `bun ./scripts/check-deploy-workflow.ts`.

### Preview / staging policy

- **PRs:** never deploy to Cloudflare. Use local `wrangler` / Docker if you need an adapter smoke before merge.
- **`dev` (post-merge):** staging Worker **`agentos`** — `NODE_ENV` / `AGENT_OS_GLOBAL_NODE_ENV` = `development`; URL `https://agentos.thatlad.workers.dev`.
- **`main`:** production Worker **`agentos-demo`** — `NODE_ENV` / `AGENT_OS_GLOBAL_NODE_ENV` = `production`; custom domain `https://agentos-demo.thatlad.dev` (`workers_dev` off).

Wrangler secrets are **per Worker**. Top-level (`agentos-demo` / `main`) vs `--env dev` (`agentos`):

```bash
cd deploy/cloudflare
# production (agentos-demo)
pnpm exec wrangler secret put AGENT_OS_EXT_AUTH_SECRET
pnpm exec wrangler secret put AGENT_OS_EXT_AUTH_DB
pnpm exec wrangler secret put AGENT_OS_EXT_DB_STORE_DATABASE_URL
# staging (agentos)
pnpm exec wrangler secret put AGENT_OS_EXT_AUTH_SECRET --env dev
pnpm exec wrangler secret put AGENT_OS_EXT_AUTH_DB --env dev
pnpm exec wrangler secret put AGENT_OS_EXT_DB_STORE_DATABASE_URL --env dev
```

### Required GitHub secrets

Repository **Settings → Secrets and variables → Actions**:

| Secret                  | Purpose                       |
| ----------------------- | ----------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Non-interactive Wrangler auth |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account     |

If either secret is missing on a deploy trigger (`main`, `dev`, or `workflow_dispatch`), the job **exits 1** (fail closed) — it does not skip deploy silently.

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

## Custom domain (production)

Production uses a Wrangler Custom Domain on zone **`thatlad.dev`**:

```jsonc
"routes": [{ "pattern": "agentos-demo.thatlad.dev", "custom_domain": true }]
```

`AGENT_OS_GLOBAL_APP_ORIGIN` / `AGENT_OS_EXT_AUTH_BASE_URL` are set to `https://agentos-demo.thatlad.dev`. `wrangler deploy` (push to `main`) creates/updates the DNS + cert. Staging (`--env dev`) is `https://agentos.thatlad.workers.dev`.

## Smoke checks

Manual deploy-path verification against the live Worker URL (ticket **64**). Complements product E2E (ticket **29**); no Playwright required for v1.

Set `BASE_URL` to the Worker `workers.dev` hostname or attached custom domain. After deploy, wait for container provisioning — the Worker may answer before `/healthz` succeeds.

```bash
export BASE_URL=https://agentos-demo.thatlad.dev   # production; staging: https://agentos.thatlad.workers.dev
```

| #   | Check          | Command / action                                                                     | Expect                                                                    |
| --- | -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 1   | Gateway health | `curl -sS -o /dev/null -w '%{http_code}\n' "$BASE_URL/healthz"`                      | `200` (gateway up; does not probe child APIs)                             |
| 2   | Auth session   | Browser: `/register` → `/login` → reload still signed in. Or cookie-jar curls below. | Session cookie round-trips; `GET /api/ext/auth/session` → `200` with user |
| 3   | Bun extension  | `curl -sS "$BASE_URL/api/ext/crm-helper/health"`                                     | `{ "ok": true }` (Worker → container → Bun sidecar)                       |
| 4   | Python service | `curl -sS "$BASE_URL/api/ext/invoice-bot/health"`                                    | Health ok (Python in container)                                           |
| 5   | Files (R2)     | If `AGENT_OS_EXT_FILES_S3_*` set: health + PUT/GET blob. Else skip.                  | `backend` shows S3; blob round-trip                                       |

### Auth (cookie jar)

```bash
COOKIE_JAR=$(mktemp)
EMAIL="smoke-$(date +%s)@example.com"
PASS='SmokeTestPass_change-me'

curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/ext/auth/sign-up" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Smoke\"}"

curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/ext/auth/sign-in" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"

curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/ext/auth/session"
rm -f "$COOKIE_JAR"
```

Secure cookies require `AGENT_OS_GLOBAL_APP_ORIGIN` / `AGENT_OS_EXT_AUTH_BASE_URL` set to this HTTPS origin. If session fails after reload, fix those vars and redeploy.

### Files round-trip (when R2 configured)

```bash
curl -sS "$BASE_URL/api/ext/files/health"
# Expect backend/label indicating S3 (not local filesystem).

KEY="smoke-$(date +%s)"
curl -sS -X PUT "$BASE_URL/api/ext/files/blobs/$KEY" \
  -H 'content-type: application/octet-stream' \
  --data-binary 'agentos-smoke'
curl -sS "$BASE_URL/api/ext/files/blobs/$KEY"
# Expect body: agentos-smoke
```

If S3 env is unset, `/api/ext/files/health` may still return ok on ephemeral local storage — skip the PUT/GET durability claim and note it in the ticket.

Keep `max_instances: 1` until tickets **60** / **61** if you rely on in-memory HITL/cache. File gaps as follow-ups under `.project/tickets/todo/`; automated Playwright against a preview URL is an optional later ticket.

## Migrate off Cloudflare

1. Stop using / delete `deploy/cloudflare/`.
2. Push the **same** root `Dockerfile` image to your registry.
3. Run it behind Cloud Run, ALB + Fargate, or Ingress + EKS on port **8080** with the portable env checklist.
