# 94 — Upgrade Node dependency to v24

**Status:** in-progress

## Goal

Raise the repo’s declared and CI Node version from 20/22 to **Node.js 24** (current Active LTS). Keep pnpm for installs and Bun for running TS/JS; Node is only the engine floor for tooling (pnpm / Actions / Wrangler).

## Depends on

- Ticket **69** (Actions already on Node 22 for Wrangler)

## Done when

- [x] Root `package.json` `engines.node` is `>=24`
- [x] `.github/workflows/ci.yml` and `deploy-cloudflare.yml` use `node-version: 24`
- [x] Docs (README + tickets index; any other explicit Node floor) say Node ≥ 24
- [x] `bun run ci` green

## Notes

- Runtime for product APIs remains **Bun** (ADR 001). This ticket does not introduce Node as a service runtime.
- Wrangler already required ≥ 22.12; Node 24 stays compatible and aligns local/CI with current LTS.
