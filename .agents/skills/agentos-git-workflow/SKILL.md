---
name: agentos-git-workflow
description: >-
  AgentOS git commits, PRs, and branch policy. Use when committing, opening a
  pull request, naming branches, or choosing feat/fix/chore for ticket work.
  Covers ticket PRs into dev and deployment PRs into main.
---

# AgentOS git workflow

## Branches

| Branch     | Role                                                                  |
| ---------- | --------------------------------------------------------------------- |
| **`dev`**  | Primary integration branch (default). Open ticket PRs **into `dev`**. |
| **`main`** | Production. Promote only via a **deployment PR** from `dev` → `main`. |

Never push commits straight to `dev` or `main`. Land changes only via pull requests.

## Before opening any PR (`dev` or `main`)

**Required:** run **`bun run ci`** at the repo root and wait for a clean exit.

- Do this for every PR — ticket PRs into `dev`, stack PRs into `dev`, and **DEPLOYMENT** PRs into `main`.
- If CI fails: fix, re-run `bun run ci`, then open/update the PR. Do not open or push a “CI later” PR.
- Include `bun run ci` (checked off when green) in the PR **Test plan**.

## Merge strategy

**Default (intended):** one ticket PR → `dev` via **squash and merge**.

| Target   | Default merge                        | Why |
| -------- | ------------------------------------ | --- |
| **`dev`**  | **Squash and merge**, **one PR per ticket** | Each ticket is one commit on `dev`, so ticket history stays separable and easy to bisect/revert per ticket. |
| **`main`** | **Squash and merge** the whole deployment PR (even when shipping many tickets) | Production history stays one commit per promotion — roll back by reverting/resetting to the previous `main` commit. |

**GitHub UI:** keep **Squash and merge** and **Rebase and merge** enabled.

Agents: when merging via `gh pr merge`, use `--squash` by default. Use `--rebase` for a **stack PR** (below) or when the user explicitly asks. Squash commit message should match the PR title.

### Stack PR → `dev` (rebase and merge) — avoid CI cascade

When **many ticket PRs** are open against `dev` at once, merging them one-by-one forces every remaining PR to update onto latest `dev` and **re-run CI** (1st PR: 1 run, 2nd: 2 runs total after sync, … → O(n²) CI). Prefer a stack instead:

1. Create a stack branch from latest `dev` (e.g. `stack/dev-tickets-64-67-…`).
2. For each ready ticket: squash that ticket’s work into **one commit** on the stack (message = normal `[feat/fix/chore](<n>): …` title). Order commits as they should land on `dev`.
3. Open **one PR**: stack branch → `dev`. Title/body list every ticket; include summary, combined test plan, and live UI QA for any customer-facing tickets.
4. **Rebase and merge** that PR so the N ticket commits land linearly on `dev` (still one commit per ticket — history stays separable). CI runs **once** on the stack PR.
5. **Close** the individual ticket PRs as redundant (comment that they landed via the stack PR + link).

Do **not** squash-merge the stack PR into `dev` — that would collapse all tickets into one commit and defeat per-ticket history on `dev`. Use rebase-and-merge (or an equivalent linear replay) only for this batch path.

Agents: build/merge a stack only when the user asks (or clearly wants to batch open PRs). Otherwise keep one squash PR per ticket.

## Automatic deploy (post-merge)

Merging a PR updates the branch tip; [`.github/workflows/deploy-cloudflare.yml`](../../../.github/workflows/deploy-cloudflare.yml) then deploys on **push** (not on the PR itself):

| After merge into | Deploy target |
| ---------------- | ------------- |
| **`dev`**        | Staging Worker `agentos` → `https://agentos.thatlad.workers.dev` |
| **`main`**       | Production Worker `agentos-demo` → `https://agentos-demo.thatlad.dev` |

PRs never deploy. Secrets / `workflow_dispatch` details: [`deploy/cloudflare/README.md`](../../../deploy/cloudflare/README.md).

## Commit title

Format (verbatim):

```text
[feat/fix/chore](<ticket number>): <commit title>
```

Examples:

```text
chore(1): reset legacy workspace
feat(2): scaffold monorepo
fix(16): correct db-store migration path
```

### Type picker

| Type    | When                                                                  |
| ---- | --------------------------------------------------------------------- |
| `feat`  | New capability or scaffold that advances the platform                 |
| `fix`   | Bug fix                                                               |
| `chore` | Cleanup, reset, tooling, docs/skills hygiene without product behavior |

Use the **ticket number** from `.project/tickets/` (e.g. `1`, `2`). Normal path: **one ticket per PR into `dev`** (squash → one commit per ticket). Batch path: **stack PR** with one commit per ticket, then **rebase and merge** (see Merge strategy).

---

## Pull requests → `dev` (ticket work)

Default for all feature/fix/chore tickets. **Squash and merge** into `dev` (one ticket = one squashed commit). When several PRs are ready and CI thrash is a concern, use the **stack PR + rebase and merge** path instead of serial squash merges.

**Title** — same shape as the commit title:

```text
[feat/fix/chore](<ticket number>): <commit title>
```

Examples:

```text
chore(1): reset legacy workspace
feat(2): scaffold monorepo
fix(67): link extension iframe CSS in production builds
```

**Body** must include:

```markdown
## Summary

- <1–3 bullets of why / what landed>

## Test plan

- [x] `bun run ci` (required before opening the PR)
- [ ] <QA / verify steps — prefer pnpm install + bun run checks from the ticket>
- [ ] <Live UI QA — required when the change is customer-facing; see below>
```

### Live UI QA (customer-facing)

If the PR ships anything a user can see or interact with in the Shell, extension iframes, auth screens, Home dashboard, settings, etc., the **Test plan must include live UI QA** steps, for example:

- Where to look (route / extension / widget)
- What should look or behave differently after merge/deploy
- Staging URL once `dev` deploy finishes (`https://agentos.thatlad.workers.dev`), or local `agentos dev` if that is enough before merge

Skip live UI QA only for non-UI work (docs, CI, pure API/backend with no customer-visible surface). Say so briefly in the test plan when skipped.

Base branch: **`dev`**.

---

## Pull requests → `main` (deployment / promotion)

Only when the user asks to promote / release `dev` → `main`. Do **not** open ticket work PRs against `main`.

**Always squash and merge** into `main`, even when the PR ships multiple tickets — production gets a single deployment commit for fast rollback to the prior working tip.

**Title** (verbatim shape):

```text
DEPLOYMENT dev->main: XX YY ZZ ...
```

Where `XX YY ZZ` are the **ticket numbers** being shipped (space-separated). Example:

```text
DEPLOYMENT dev->main: 64 67
```

**Body** must include:

```markdown
## Summary

- <why this promotion / what lands in production>

## Cherry-picked commits

| Ticket | Commit | Title |
| ------ | ------ | ----- |
| 67     | `abc1234` | fix(67): link extension iframe CSS in production builds |
| 64     | `def5678` | feat(64): … |

## Merge conflicts

- <none> **or** describe conflicts resolved (files + how)

## Test plan

- [x] `bun run ci` (required before opening the PR)
```

Notes for agents:

- Run **`bun run ci`** and only open the PR when green (same rule as `dev` PRs).
- Prefer a clean promotion of `dev` into `main` (or an agreed cherry-pick set). Document every shipped ticket and its **pre-squash** commit(s) on `dev` in the table (those SHAs identify what was included; the squash on `main` creates a new SHA).
- If history was rewritten or only a subset of `dev` is promoted, say so in Summary and keep the table accurate.
- Squash-merge the deployment PR by default (`gh pr merge --squash`). Prefer not to land a multi-commit merge commit on `main`.
- After merge, production deploy runs automatically via the Cloudflare workflow (see above).

---

## Agent rules

1. Read this skill before `git commit` or `gh pr create` / `gh pr merge` for AgentOS ticket or deployment work.
2. **Before every `gh pr create` (or pushing commits that open/update a PR to `dev` or `main`): run `bun run ci` and only proceed when it passes.**
3. Default merge is **squash** (`--squash`): per-ticket into `dev`; whole deployment PR into `main`. Use **rebase** (`--rebase`) for stack PRs into `dev` (or when the user asks). Never squash-merge a multi-ticket stack into `dev`.
4. Do not amend/force-push shared `dev`/`main` unless the user explicitly requests a history rewrite.
5. Match existing user commit rules (HEREDOC messages, no `-i`, no secrets).
6. After merging to `dev`, leave `main` alone unless the user asks for a **DEPLOYMENT** PR.
7. Ticket folder status: keep the ticket in `in-progress/` through commit/PR/merge. Never move it to `done/` — ticket reconciliation owns that (see **agentos-ticket-planner**).
