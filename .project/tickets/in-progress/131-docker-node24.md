# 131 — Docker builder runs pnpm on Node 24

**Status:** in-progress

## Goal

The production image builds with `pnpm install` running on Node 24, as ticket 94 intended. The builder used to install pnpm with `get.pnpm.io`, which ships a standalone pnpm binary that embeds Node 20.11.1. Its engine check then printed `Unsupported engine: wanted: {"node":">=24"} (current: {"node":"v20.11.1"...})`.

## Depends on

- Ticket 94 (Node 24 floor in `engines` and CI)
- Ticket 59 / 62 (Dockerfile and Cloudflare container image)

## Done when

- [x] Builder stage starts from `node:24-bookworm-slim`. `oven/bun:1.4` is copied in for `bun` and `bunx`.
- [x] pnpm is installed with `npm install -g pnpm@9.15.4` (no `get.pnpm.io`)
- [x] `docker build` completes with no `Unsupported engine` warning
- [x] Runtime image starts and `GET /healthz` returns `{"ok":true}`
- [x] `bun run ci` passes

## Notes

- Runtime stage is unchanged (`oven/bun:1.4`). It only runs Bun, so it doesn't need Node.
- `pnpm prune --prod` still prints a `The modules directories will be removed ... Proceed? (Y/n)` prompt, which is auto-accepted. It is cosmetic and doesn't block the build.
- Verified locally on Docker 29.6.1 (arm64) with BuildKit.

## Verify

- `docker build -t agentos:local .`
- `docker run --rm -p 8080:8080 -e AGENT_OS_EXT_AUTH_SECRET=$(openssl rand -hex 32) agentos:local` then `curl -sS http://127.0.0.1:8080/healthz`
- `bun run ci`
