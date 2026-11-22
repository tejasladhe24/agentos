# 59 — Deploy layout + portable runbook

**Status:** todo

## Goal

Establish a host-agnostic `deploy/` convention and docs so Cloudflare is an **adapter**, not the architecture. Document the same image + env contract for Cloudflare Containers, Cloud Run, ECS Fargate, and EKS — migration = new manifests, not a rewrite.

## Depends on

- Ticket **54** (`agentos start`)
- Ticket **58** (Dockerfile)

## Done when

- [ ] `deploy/README.md` explains: portable core vs per-cloud adapters
- [ ] Env checklist: gateway/app origin, auth secret + DB, db-store URL, files S3, AI keys
- [ ] Explicit non-goals: no D1/KV/DO for app state; no `@cloudflare/*` in `packages/core`
- [ ] Short “migrate off Cloudflare” section (reuse image → ALB/Ingress/Cloud Run)
- [ ] Pointers from `.project/docs/` (architecture or cookbook) to the runbook
- [ ] Placeholder note for future `deploy/k8s/` / `deploy/gcp/` (out of scope to implement here)

## Notes

- Cloudflare-specific files land in ticket **62** under `deploy/cloudflare/` only.
- Keep ticket **30** (Next host spike) separate — this is container deploy, not Next.
