# Roadmap

Implementation is tracked as numbered tickets in [../tickets/](../tickets/). Do them in order.

| Phase  | Focus                                                        | Tickets (approx)                                     |
| ------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| 0      | Reset legacy `@app/*` workspace                              | 1                                                    |
| 1      | Scaffold monorepo + core exports                             | 2–3                                                  |
| 2      | Comlink SDK + Shell + host + client + manager + Cmd+K        | 4–9                                                  |
| 3      | Vite scanner, registry, iframe entries, gateway, agent plane | 10–14                                                |
| 4      | Driving builtins: auth, db-store, cache-store, ai            | 15–18                                                |
| 5      | Supporting builtins                                          | 19                                                   |
| 6      | `@agentos/core/api/*` + file routes + Python `agentos`       | 20–24                                                |
| 7      | Samples: crm-helper, invoice-bot                             | 25–26                                                |
| 8      | CLI `agentos dev`                                            | 27                                                   |
| 9      | Docs polish (if gaps)                                        | 28                                                   |
| 10     | E2E verification                                             | 29                                                   |
| Later  | Next.js host adapter spike                                   | 30                                                   |
| Setup  | Skills + pnpm/Bun ADR                                        | **31** (docs/skills setup — may be done before code) |
| Infra  | Typed env (`@t3-oss/env-core`): platform + extension `keys`  | **33** (app extends / loads at runtime)              |
| Polish | Per-extension Activity Bar icons (`meta.json` → Shell)       | **34**–**37**                                        |
| Polish | Activity Bar primary + secondary (builtins-only bottom)      | **38**                                               |
| Polish | Contextual sidebar + Shell panels left                       | **39**                                               |
| Polish | App-level `ui/dashboard.tsx` Home surface                    | **40**                                               |
| DX     | CLI scaffold consumer app (`agentos create` / `init`)        | **42**                                               |
| Deploy | Portable production gateway + `agentos start` + image        | **53–59**                                            |
| Deploy | Durable enable-state / HITL (before scale)                   | **60–61**                                            |
| Deploy | Cloudflare Containers adapter + CI + smoke (thin `deploy/`)  | **62–64**                                            |

**Status:** setup docs/skills can proceed before ticket 1. **Do not start ticket 1** until explicitly asked to build. Deploy tickets (**53+**) are host-agnostic first; Cloudflare is an adapter under `deploy/cloudflare/`.
