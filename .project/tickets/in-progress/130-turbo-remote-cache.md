# 130 — Turborepo remote cache for CI and deploys

**Status:** in-progress

## Goal

Share the Turborepo task cache between laptops and GitHub Actions (Vercel Remote Cache) so `bun run ci` replays unchanged tasks instead of re-running them. This speeds up PR CI and the `deploy-cloudflare` workflow, which runs `pnpm run ci` before every deploy.

## Depends on

- Vercel account linked via `turbo login` / `turbo link` (personal scope). Remote Cache is free on all Vercel plans.
- GitHub repo secrets `TURBO_TOKEN` (dedicated Vercel access token, scope: All Projects) and `TURBO_TEAM` (Vercel scope ID).

## Done when

- [x] `turbo.json`: `//#test` caching enabled (was `cache: false`, so the full test suite ran on every `bun run ci`)
- [x] `.github/workflows/ci.yml` and `.github/workflows/deploy-cloudflare.yml` pass `TURBO_TOKEN` and `TURBO_TEAM` from repo secrets
- [x] Local remote-only check: after one upload, all 9 `bun run ci` tasks replay from Vercel with the local cache disabled (`FULL TURBO`)
- [x] `bun run ci` passes
- [ ] First CI run on the PR shows remote cache hits for unchanged tasks

## Notes

- PR CI (`ci.yml`) runs one `ci` job that calls `bun run ci`, so lint, format, typecheck, build, and test all go through Turbo and the remote cache. The former separate jobs bypassed Turbo. Rulesets require no named status checks, so renaming jobs is safe.
- `.turbo/config.json` (from `turbo link`) is gitignored. CI relies only on the `TURBO_*` env vars.
- Without the secrets, Turbo falls back to the local cache and does not fail. Fork PRs do not receive secrets and simply get cache misses.
- Turbo deprecates `--remote-only`. Use `--cache=remote:rw,local:` to test remote-only behavior.
- Caching `//#test` is only safe while tests are deterministic. Tests that depend on the clock, the network, or live services must not be cached.
- No Vercel project or GitHub integration is required. Turbo only uses the team cache, keyed by task hash.
- Build-time env vars that affect outputs must be declared in `env` / `globalEnv` in `turbo.json`. None are read by the cached tasks today.

## Verify

- `bun run ci`
- `bun run ci --cache=remote:rw,local:` (after one successful run, expect `FULL TURBO`)
- Check the `ci` workflow log for `cache hit, replaying logs` lines
