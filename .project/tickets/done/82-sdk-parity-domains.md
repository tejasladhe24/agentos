# 82 — SDK parity: files, events, audit, secrets, notifications

**Status:** done

## Goal

Bring **Python `agentos`** and **TS `@agentos/core/api/*`** clients to parity for supporting builtins: **files**, **events**, **audit**, **secrets**, and **notifications** (today Python covers auth/store/ai/hitl only).

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — gap formerly **61**.

## Depends on

- Ticket **23** / **24** (API kit domains + Python package) — done
- Tickets **73** / **74** / **77** — preferred so new clients match durable/email/vault shapes

## Done when

- [x] Python modules for files, events, audit, secrets, notifications with tests
- [x] TS API kit exports/docs confirm the same domains are first-class for Bun routes
- [x] Error shapes and auth headers consistent across SDKs
- [x] Docs: quick table of domain → import path (TS + Python)

## Notes

- Services can call builtin HTTP routes directly until this lands (MVP workaround).
- Implemented: TS `@agentos/core/api/audit` + `notifications`; Python `files` / `events` / `audit` / `secrets` / `notifications`; domain table in `packages.md` + Python README.
