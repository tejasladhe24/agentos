# 60 — Persist extension enable-state

**Status:** todo

## Goal

Persist customer extension enable/disable toggles (today in-memory in the gateway process) so restarts and single-replica deploys do not reset Extension Manager state.

## Depends on

- Ticket **8** (Extension Manager) — done
- Ticket **53** (production gateway handlers)
- Ticket **16** (db-store) — done

## Done when

- [ ] Enable map loaded/saved via db-store (or equivalent durable store) — not only `Map` in memory
- [ ] Builtins / locked extensions remain non-disableable
- [ ] Dev and `agentos start` share the same persistence behavior
- [ ] Tests cover restart / reload retaining toggles
- [ ] Docs note single-replica vs multi-replica implications

## Notes

- Recommended before relying on Extension Manager in production; can ship first Cloudflare deploy without it if reset-on-restart is accepted.
- Do not use Cloudflare KV for this — keep portable via db-store.
