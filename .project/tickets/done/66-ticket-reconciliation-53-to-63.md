# 66 — Ticket reconciliation: promote covered in-progress → done (53–63)

**Status:** done

## Goal

Run the **ticket reconciliation** process for the portable production + Cloudflare adapter batch: move in-progress tickets whose **Done when** items are all checked from `in-progress/` → `done/`, and set `**Status:** done`.

## Depends on

- None (process chore). User-authorized reconciliation for the covered batch.

## Candidates

All **Done when** checkboxes are `[x]` — verify once more before moving:

| Ticket | Title                                   |
| ------ | --------------------------------------- |
| **53** | Production gateway handlers             |
| **54** | CLI `agentos start`                     |
| **55** | Auth production hardening               |
| **56** | Auth Postgres backend                   |
| **57** | Files S3-compatible backend             |
| **58** | Root Dockerfile                         |
| **59** | Deploy layout + portable runbook        |
| **60** | Persist extension enable-state          |
| **61** | Durable HITL / notifications state      |
| **62** | `deploy/cloudflare` Worker + Containers |
| **63** | Cloudflare CI deploy workflow           |

Leave incomplete tickets in `in-progress/` (e.g. **64** until live smoke / **65**).

## Done when

- [x] Each covered ticket file is moved `in-progress/` → `done/`
- [x] Each moved file has `**Status:** done`
- [x] Incomplete tickets remain accurate in `in-progress/` or `todo/`
- [x] [`.project/tickets/README.md`](../README.md) open-set note updated (light touch)
- [x] No product code changes — docs/ticket-folder moves only

## Notes

Prefer one reconciliation batch so history stays clear. Do not renumber tickets.

## Covered in this reconciliation

- Promoted **53–63** → `done/` with `**Status:** done`
- Left **64** in `in-progress/` (runbook done; live smoke → ticket **65**)
- Open backlog in `todo/`: **29**, **30**, **65**
