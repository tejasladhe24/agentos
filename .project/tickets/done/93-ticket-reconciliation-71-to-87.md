# 93 — Ticket reconciliation: promote covered in-progress → done (71–87)

**Status:** done

## Goal

Run the **ticket reconciliation** process for the portfolio platform-capability batch: move in-progress tickets whose **Done when** items are all checked (and whose implementations are in git history) from `in-progress/` → `done/`, and set `**Status:** done`.

## Depends on

- None (process chore). User-authorized reconciliation for the covered batch.

## Candidates

Verified against git history (`feat(71)` … `feat(87)` PRs) and all **Done when** checkboxes `[x]`:

| Ticket | Title                                    | Commit / PR              |
| ------ | ---------------------------------------- | ------------------------ |
| **71** | Tenancy: org model + org-scoped db-store | `bda207f` feat(71) (#69) |
| **72** | Public extension routes                  | `37815e8` feat(72) (#70) |
| **73** | Notifications email/SMS                  | `e80fab5` feat(73) (#71) |
| **74** | Durable events + scheduler               | `b35609b` feat(74) (#72) |
| **75** | Auth SSO + role admin                    | `6aa3b64` feat(75) (#73) |
| **76** | db-store query operators                 | `24038b5` feat(76) (#74) |
| **77** | Per-tenant secrets vault                 | `df7bfce` feat(77) (#75) |
| **78** | OAuth + webhook kits                     | `3143dcc` feat(78) (#76) |
| **79** | vector-store builtin                     | `365dfae` feat(79) (#77) |
| **80** | Worker service type                      | `1c43716` feat(80) (#78) |
| **81** | cache-store Redis backend                | `b36f352` feat(81) (#79) |
| **82** | SDK parity                               | `aa4a8ed` feat(82) (#80) |
| **83** | Dual Bun + Python in meta.json           | `3dc3650` feat(83) (#81) |
| **84** | db-store bulk insert + retention         | `184de38` feat(84) (#82) |
| **85** | AI structured/multimodal                 | `233fb68` feat(85) (#83) |
| **86** | Inbound email                            | `ac7d54e` feat(86) (#84) |
| **87** | Retention + subject deletion             | `436d9c0` feat(87) (#85) |

Leave incomplete tickets in `todo/` (**29**, **30**, **65**, **70**, **88**–**92**).

## Done when

- [x] Each covered ticket file is moved `in-progress/` → `done/`
- [x] Each moved file has `**Status:** done`
- [x] Incomplete tickets remain accurate in `todo/` (or `in-progress/`)
- [x] [`.project/tickets/README.md`](../README.md) open-set note updated (light touch)
- [x] No product code changes — docs/ticket-folder moves only

## Notes

Prefer one reconciliation batch so history stays clear. Do not renumber tickets.

## Covered in this reconciliation

- Promoted **71–87** → `done/` with `**Status:** done`
- `in-progress/` empty after this batch
- Open backlog in `todo/`: **29**, **30**, **65**, **70**, **88**–**92**
