# 69 — GitHub Actions Node 22 for Wrangler

**Status:** done

## Goal

Cloudflare Wrangler requires Node.js ≥ **22.12**. Deploy failed after secrets were fixed because Actions still used Node **20**. Bump workflow `node-version` so `wrangler deploy` can run.

## Depends on

- Ticket **63** / **68** (deploy workflow)

## Done when

- [x] `.github/workflows/deploy-cloudflare.yml` and `ci.yml` use Node 22
- [x] `bun run ci` green
- [ ] Staging deploy succeeds past the wrangler step

## Notes

- Error: `Wrangler requires at least Node.js v22.12.0. You are using v20.20.2.`
