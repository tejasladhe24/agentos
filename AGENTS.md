# Agent instructions (AgentOS)

This repository is the **AgentOS** experiment. Coding agents must follow project docs and skills.

## Required reading

1. [`.project/docs/concepts.md`](.project/docs/concepts.md) — extension vs service vs packages
2. [`.project/docs/architecture.md`](.project/docs/architecture.md)
3. Skills:
   - [`.agents/skills/agentos-architecture/SKILL.md`](.agents/skills/agentos-architecture/SKILL.md)
   - [`.agents/skills/agentos-ticket-planner/SKILL.md`](.agents/skills/agentos-ticket-planner/SKILL.md)
   - [`.agents/skills/agentos-bun-runtime/SKILL.md`](.agents/skills/agentos-bun-runtime/SKILL.md)
   - [`.agents/skills/agentos-git-workflow/SKILL.md`](.agents/skills/agentos-git-workflow/SKILL.md) — commits; **`bun run ci` before every PR** (to `dev` or `main`); default squash one-ticket PRs → `dev`; stack + rebase-merge when batching; squash `DEPLOYMENT dev->main: …` → `main`; post-merge Cloudflare deploy

## Hard rules

- **pnpm** for workspace install; **Bun** to run all TS/JS; **never Node** for services.
- UI → `@agentos/core/client` only. API routes → `@agentos/core/api/*` only.
- Python backends → `services/<id>/`, not inside `extensions/`.
- No customer `DATABASE_URL` — use builtin **db-store** / **cache-store**.
- Auth+RBAC → builtin **auth** (Better Auth) via `@agentos/core/api/auth` only.
- **UI primitives** → `@agentos/ui` (shadcn + Tailwind). Use `Button`, `Input`, `Checkbox`, `Select`, `DropdownMenu`, etc. by default. Do **not** use native HTML controls (`<button>`, `<input>`, `<select>`, …) unless there is a specific accessibility, semantic, or platform reason.
- **File names** → **kebab-case** for source files (`activity-bar.tsx`, `mount.test.tsx`, `host-client.test.ts`). Exported symbols stay PascalCase/camelCase as usual.
- **Module folders** → each package module uses `index.ts` + `lib/` + `tests/` (and `components/` when there is React UI).

## Tickets

Work is ordered in [`.project/tickets/`](.project/tickets/). Do not start **build** tickets (1+) until the user explicitly asks. Docs/skills setup is separate.

**Status:** on implement, move the ticket `todo/` → `in-progress/`. Do **not** move tickets to `done/` — reconciliation owns that.

## Docs index

[`.project/docs/README.md`](.project/docs/README.md)
