# 56 — Auth Postgres backend

**Status:** todo

## Goal

Support `AGENT_OS_EXT_AUTH_DB=postgres://…` / `postgresql://…` for Better Auth so identity/RBAC survive ephemeral container disks (Cloudflare Containers, Cloud Run, Fargate, etc.). Keep SQLite as the local-dev default.

## Depends on

- Ticket **15** (builtin auth) — done
- Ticket **55** (auth production hardening) — preferred before shipping prod configs

## Done when

- [ ] `createAuth` selects SQLite vs Postgres from the DB URL / path
- [ ] Schema / migrations work for Postgres (startup or documented migrate step)
- [ ] Local default remains `~/.agentos/store/auth.sqlite` when unset
- [ ] Tests cover both dialects (Postgres via testcontainer or skip-if-unset)
- [ ] Docs: production uses managed Postgres (Neon / RDS / Cloud SQL); same env key

## Notes

- Align with ADR **004**: customer extensions still must not take their own `DATABASE_URL`; only auth + db-store own SQL credentials.
- db-store already supports Postgres via `AGENT_OS_EXT_DB_STORE_DATABASE_URL` — mirror that pattern for naming/docs.
