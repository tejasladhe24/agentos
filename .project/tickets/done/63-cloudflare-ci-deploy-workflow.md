# 63 — Cloudflare CI deploy workflow

**Status:** done

## Goal

Automate build verification and `wrangler deploy` for the Cloudflare adapter on pushes to `main` (and optionally staging on `dev`), using GitHub Actions secrets — without baking Cloudflare into the core package scripts beyond calling the adapter.

## Depends on

- Ticket **62** (`deploy/cloudflare`)
- Existing monorepo `pnpm ci` / turbo pipeline

## Done when

- [x] Workflow runs install + `pnpm ci` (or agreed subset) before deploy
- [x] Deploys via wrangler from `deploy/cloudflare` using `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
- [x] Document required GitHub secrets and Cloudflare token permissions
- [x] Fail closed if secrets missing on protected branches
- [x] Does not force Cloudflare deploy on every PR (preview policy documented)

## Notes

- Keep branch policy aligned with AgentOS git workflow (`dev` / `main`).
- Image build may happen inside `wrangler deploy` (Containers) — document duration / caching expectations.
