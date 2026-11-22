# 59 — Deploy layout + portable runbook

**Status:** in-progress

## Goal

Establish a host-agnostic `deploy/` convention and docs so Cloudflare is an **adapter**, not the architecture. Document the same image + env contract for Cloudflare Containers, Cloud Run, ECS Fargate, and EKS — migration = new manifests, not a rewrite.

## Depends on

- Ticket **54** (`agentos start`)
- Ticket **58** (Dockerfile)

## Done when

- [x] `deploy/README.md` explains: portable core vs per-cloud adapters
- [x] Env checklist: gateway/app origin, auth secret + DB, db-store URL, files S3, AI keys
- [x] Explicit non-goals: no D1/KV/DO for app state; no `@cloudflare/*` in `packages/core`
- [x] Short “migrate off Cloudflare” section (reuse image → ALB/Ingress/Cloud Run)
- [x] Pointers from `.project/docs/` (architecture or cookbook) to the runbook
- [x] Placeholder note for future `deploy/k8s/` / `deploy/gcp/` (out of scope to implement here)

## Notes

- Cloudflare-specific files land in ticket **62** under `deploy/cloudflare/` only.
- Keep ticket **30** (Next host spike) separate — this is container deploy, not Next.
