# 122 — Ticket reconciliation: promote covered in-progress → done (94–114)

**Status:** done

## Goal

Run the **ticket reconciliation** process for the operator-UI and BYOK / storage-mounts batches: move in-progress tickets whose implementations are merged into `dev` from `in-progress/` → `done/`, and set `**Status:** done`.

## Depends on

- None (process chore). User-authorized reconciliation for the covered batch.

## Candidates

Verified against git history on `dev`:

| Ticket  | Title                                     | Commit / PR                         |
| ------- | ----------------------------------------- | ----------------------------------- |
| **94**  | Upgrade Node to v24                       | `3902fc7` chore(94) (#87)           |
| **95**  | Loading states                            | `0e8f216` feat(95) (#88)            |
| **96**  | Files Drive UI                            | `fc82f85`, `a947e23` feat(96) (#97) |
| **97**  | Audit Activity UI                         | `527e3ee` feat(97)                  |
| **98**  | Secrets manager UI                        | `5db3680` feat(98)                  |
| **99**  | Email manager UI                          | `173dca5` feat(99)                  |
| **100** | Python store org context                  | `4ccd164` fix(100) (#96)            |
| **101** | Extension-registered Settings             | `bc0f271` feat(101) (#98)           |
| **102** | Shell keep views mounted                  | `c99ed6b` fix(102) (#99)            |
| **103** | Tenant integrations foundation            | `ce35890` feat(103) (#102)          |
| **104** | User-owned secrets                        | `b94675c` feat(104) (#103)          |
| **105** | Email + SMS sending BYOK                  | `1849e8d` feat(105) (#104)          |
| **106** | Inbound email via Resend; Mailgun removed | `36c8951` feat(106) (#106)          |
| **107** | Inbound email via Cloudflare (platform)   | `172a67c` feat(107) (#110)          |
| **108** | Real AI providers                         | `1a0ff49` feat(108) (#101)          |
| **109** | AI BYOK                                   | `d95db83` feat(109) (#107)          |
| **110** | Files storage mounts foundation           | `568de16` feat(110) (#105)          |
| **111** | S3-compatible org mounts                  | `5ed7943` feat(111) (#108)          |
| **112** | UploadThing + Vercel Blob mounts          | `3ced06f` feat(112) (#109)          |
| **113** | Personal mounts + Google Drive            | `9ccb432` feat(113) (#111)          |
| **114** | OneDrive + SharePoint personal mounts     | `55d9239` feat(114) (#112)          |

Unchecked boxes left as-is in the moved files (implementation merged; boxes were not ticked or are manual local checks):

- **96** — manual "all actions against real builtin in `agentos dev`" check
- **98**, **99** — Done-when boxes not ticked in the ticket file; UIs and APIs shipped in the commits above
- **100** — local verify box

## Done when

- [x] Each covered ticket file is moved `in-progress/` → `done/`
- [x] Each moved file has `**Status:** done`
- [x] Incomplete tickets remain in `todo/` (**29**, **30**, **65**, **70**, **88**–**92**, **115**–**121**, **123**–**126**)
- [x] [`.project/tickets/README.md`](../README.md) open-set note updated
- [x] No product code changes — docs/ticket-folder moves only

## Covered in this reconciliation

- Promoted **94–114** → `done/` with `**Status:** done`
- `in-progress/` empty after this batch
