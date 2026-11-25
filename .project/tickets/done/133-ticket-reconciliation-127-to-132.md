# 133 — Ticket reconciliation: promote covered in-progress → done (127–130, 132)

**Status:** done

## Goal

Run the **ticket reconciliation** process for the settings, forms, CI cache, and pnpm 12 batch: move in-progress tickets whose implementations are merged into `dev` from `in-progress/` → `done/`, and set `**Status:** done`.

## Depends on

- None (process chore). User-authorized reconciliation for the covered batch.

## Candidates

Verified against git history on `dev`. Nothing in `todo/` is implemented; those tickets stay in `todo/`.

| Ticket  | Title                                              | Commit / PR                 |
| ------- | -------------------------------------------------- | --------------------------- |
| **127** | Settings Field layout (Files, AI, Email, SMS)      | `e1d0173` fix(127) (#121)   |
| **128** | Role-scoped Activity Bar, email sender, org tables | `703d00e` feat(128) (#119)  |
| **129** | TanStack Form + Zod                                | `a7da59c` feat(129) (#120)  |
| **130** | Turborepo remote cache                             | `0e41a73` chore(130) (#122) |
| **132** | pnpm 12; drop Node from the Docker builder         | `5d6c10c` chore(132) (#124) |

Unchecked box left as-is in the moved file:

- **130** — "First CI run on the PR shows remote cache hits". PR **#122** recorded it: first `CI` run had 4/9 remote hits; a rerun of the same commit was `FULL TURBO`. The ticket file box was not ticked before merge.

**131** has no ticket file. It is superseded by **132** (Node 24 Docker builder replaced by the pnpm 12 standalone installer). Not promoted.

## Done when

- [x] Each covered ticket file is moved `in-progress/` → `done/`
- [x] Each moved file has `**Status:** done`
- [x] Incomplete tickets remain in `todo/` (**29**, **30**, **65**, **70**, **88**–**92**, **115**–**121**, **123**–**126**)
- [x] [`.project/tickets/README.md`](../README.md) open-set note updated
- [x] No product code changes — docs/ticket-folder moves only

## Covered in this reconciliation

- Promoted **127**, **128**, **129**, **130**, **132** → `done/` with `**Status:** done`
- `in-progress/` empty after this batch
- `todo/` unchanged (none of those tickets are implemented)
