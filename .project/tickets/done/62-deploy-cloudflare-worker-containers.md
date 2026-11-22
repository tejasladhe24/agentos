# 62 — `deploy/cloudflare` Worker + Containers adapter

**Status:** done

## Goal

Add a **thin** Cloudflare adapter: Worker forwards HTTPS to a Cloudflare Container running the portable image (`agentos start` on 8080). No AgentOS domain logic in the Worker. Disposable when migrating to GCP/AWS.

## Depends on

- Ticket **58** (Dockerfile)
- Ticket **59** (deploy layout / runbook)
- Tickets **55**–**57** (auth hardening, auth Postgres, files S3) — required for a durable deploy

## Done when

- [x] `deploy/cloudflare/wrangler.jsonc` (or toml) configures Container + Durable Object binding
- [x] `deploy/cloudflare/worker.ts` proxies via Durable Object Container API (`ctx.container`) — port **8080**, readiness `/healthz`; `max_instances: 1` (not deprecated `@cloudflare/containers`)
- [x] Secrets / env forwarded into the container (auth, DB URLs, R2/S3, AI keys, app origin)
- [x] Package scripts to deploy from `deploy/cloudflare` (wrangler) — `pnpm deploy:cloudflare`
- [x] Zero `@cloudflare/*` imports under `packages/core` or builtins
- [x] Runbook section: Workers Paid plan, R2 bucket, Neon (or Postgres), custom domain

## Notes

- **Migration:** delete or stop using `deploy/cloudflare/`; same image runs behind ALB / Ingress / Cloud Run.
- Do not serve SPA exclusively from Workers static assets as source of truth — container serves `dist/`.
- Optional later: Workers assets for cold-start UX only, still proxying `/api/*` to the container.
- `@cloudflare/containers` is deprecated upstream; adapter uses `DurableObject` + `ctx.container` instead while keeping the same thin proxy contract.
