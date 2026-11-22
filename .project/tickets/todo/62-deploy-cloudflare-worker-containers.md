# 62 — `deploy/cloudflare` Worker + Containers adapter

**Status:** todo

## Goal

Add a **thin** Cloudflare adapter: Worker forwards HTTPS to a Cloudflare Container running the portable image (`agentos start` on 8080). No AgentOS domain logic in the Worker. Disposable when migrating to GCP/AWS.

## Depends on

- Ticket **58** (Dockerfile)
- Ticket **59** (deploy layout / runbook)
- Tickets **55**–**57** (auth hardening, auth Postgres, files S3) — required for a durable deploy

## Done when

- [ ] `deploy/cloudflare/wrangler.jsonc` (or toml) configures Container + Durable Object binding
- [ ] `deploy/cloudflare/worker.ts` uses `@cloudflare/containers` — proxy only; `defaultPort = 8080`; `max_instances: 1`
- [ ] Secrets / env forwarded into the container (auth, DB URLs, R2/S3, AI keys, app origin)
- [ ] Package scripts to deploy from `deploy/cloudflare` (wrangler)
- [ ] Zero `@cloudflare/*` imports under `packages/core` or builtins
- [ ] Runbook section: Workers Paid plan, R2 bucket, Neon (or Postgres), custom domain

## Notes

- **Migration:** delete or stop using `deploy/cloudflare/`; same image runs behind ALB / Ingress / Cloud Run.
- Do not serve SPA exclusively from Workers static assets as source of truth — container serves `dist/`.
- Optional later: Workers assets for cold-start UX only, still proxying `/api/*` to the container.
