# AgentOS — project docs

**Read [concepts.md](./concepts.md) first** before planning or implementing any ticket.

| Doc                                                              | Purpose                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| [concepts.md](./concepts.md)                                     | Glossary: extension vs service vs package boundaries |
| [architecture.md](./architecture.md)                             | System design, gateway, builtins, Comlink            |
| [codebase-and-deployment.md](./codebase-and-deployment.md)       | Plain-language map of the repo + how deploy works    |
| [deploy runbook](../../deploy/README.md)                         | Portable image + env contract; per-cloud adapters    |
| [prd.md](./prd.md)                                               | Product intent for this experiment                   |
| [roadmap.md](./roadmap.md)                                       | Delivery phases ↔ tickets                            |
| [packages.md](./packages.md)                                     | `@agentos/core` exports and Python `agentos`         |
| [extensions.md](./extensions.md)                                 | Convention guide for `extensions/<id>/`              |
| [services.md](./services.md)                                     | Python services under `services/<id>/`               |
| [builtins.md](./builtins.md)                                     | Driving & supporting platform extensions             |
| [skills.md](./skills.md)                                         | Agent skills (custom + third-party)                  |
| [adr/](./adr/)                                                   | Architecture Decision Records                        |
| [cookbook/](./cookbook/)                                         | Step-by-step how-tos                                 |
| [cookbook/create-client-app.md](./cookbook/create-client-app.md) | `agentos create` from `templates/`                   |

Tickets live in [../tickets/](../tickets/) (`todo` → `in-progress` → `done`).
