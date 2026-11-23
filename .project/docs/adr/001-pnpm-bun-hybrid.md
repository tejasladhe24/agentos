# ADR 001 — pnpm workspaces + Bun runtime

## Status

Accepted

## Context

We need a JS monorepo and a fast TS runtime. Using Bun for _everything_ (including install) conflicts with existing pnpm workspace habits; using Node to run services is explicitly undesired.

## Decision

- **pnpm** owns install, lockfile (`pnpm-lock.yaml`), and workspace filters.
- **Bun** owns process execution for all TypeScript/JavaScript: APIs, CLI helpers, Vite via `bunx`/`bun run`.
- **Never** use Node to run AgentOS TS services.
- **Node ≥ 24** is the declared engine floor for pnpm / GitHub Actions / Wrangler tooling only (`package.json` `engines.node`, workflow `node-version`).

## Consequences

- Scripts: `"dev": "bun run …"` / `bun ./api/server.ts`.
- Agents using `bun-cli` skill must respect this override (do not replace pnpm with bun install in this repo unless an ADR changes).
- CI: setup Node 24 → `pnpm install --frozen-lockfile` → `bun run` tests/servers.
