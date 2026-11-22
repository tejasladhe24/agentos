# 55 — Auth production hardening

**Status:** in-progress

## Goal

Make builtin auth safe for HTTPS deployments: no default secret in production, secure cookies when the app origin is `https`, correct `trustedOrigins` / `baseURL` from env, and no demo-user seeding in production.

## Depends on

- Ticket **15** (builtin auth) — done
- Ticket **43** (auth gate + config) — done

## Done when

- [x] Production refuses to start (or hard-fails) without `AGENT_OS_EXT_AUTH_SECRET`
- [x] Cookies: `secure` + `useSecureCookies` when `AGENT_OS_GLOBAL_APP_ORIGIN` (or base URL) is `https`
- [x] `trustedOrigins` includes production app origin (not only localhost)
- [x] Demo admin/viewer seed disabled when `NODE_ENV=production` (or explicit flag)
- [x] Tests cover secure-cookie / missing-secret behavior
- [x] Env docs list required production auth vars

## Notes

- Secrets stay in `createEnv` / runtime env — never `agentos.config.ts`.
- Postgres auth adapter is ticket **56** (can land after or alongside this).
