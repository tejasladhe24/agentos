# 68 — Deploy workflow command smoke (pnpm run ci)

**Status:** in-progress

## Goal

Stop deploy-pipeline typos (especially bare `pnpm ci`, which is a pnpm builtin and never runs the repo `ci` script) from failing post-merge Cloudflare deploys. Validate `.github/workflows/deploy-cloudflare.yml` pnpm invocations against root `package.json` scripts in PR CI and again before deploy.

## Depends on

- Ticket **63** (Cloudflare CI deploy workflow)

## Done when

- [x] Deploy workflow uses `pnpm run ci` / `pnpm run deploy:cloudflare(:dev)`
- [x] `check-deploy-workflow` fails on bare `pnpm ci` and unknown scripts
- [x] PR CI job runs the smoke check; deploy workflow runs it before full CI
- [x] README documents the `pnpm run` rule

## Notes

- Live app smoke (ticket **64** / **65**) is separate — this ticket is pipeline preflight only.
- Root cause of failed staging deploy after #63: `ERR_PNPM_CI_NOT_IMPLEMENTED` from bare `pnpm ci`.
