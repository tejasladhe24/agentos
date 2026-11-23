# `agentos` (Python SDK)

Installable SDK for **AgentOS services** under `services/<id>/`. Mirrors `@agentos/core/api/*` domains for FastAPI backends.

**Repo:** [packages/python](https://github.com/tejasStarboard/agentos/tree/main/packages/python)

**Python code lives in `services/`, not `extensions/`.** Extensions keep UI + agent decls (TypeScript); Python backends are separate processes linked from `meta.json` (`api.language: "python"`). See [ADR 003](../../.project/docs/adr/003-python-services-outside-extensions.md) and [services.md](../../.project/docs/services.md).

## Install

From the repo (editable):

```bash
cd packages/python
uv pip install -e ".[dev]"
# or: pip install -e ".[dev]"
```

Services depend on this package from their own `pyproject.toml` (path or published version).

## Modules

| Module                  | Role                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `agentos.create_app`    | FastAPI factory with `GET /health` → `{ "ok": true }`                     |
| `agentos.auth`          | Session + RBAC `Depends` → gateway `/api/ext/auth`                        |
| `agentos.store`         | `db_store` / `cache_store` → db-store / cache-store builtins              |
| `agentos.ai`            | Text/image/embed/chat → `/api/ext/ai`                                     |
| `agentos.hitl`          | Approvals → `/api/ext/hitl`                                               |
| `agentos.files`         | Blob put/get → `/api/ext/files`                                           |
| `agentos.events`        | Publish, queue claim/ack, jobs → `/api/ext/events`                        |
| `agentos.audit`         | Append/list audit entries → `/api/ext/audit`                              |
| `agentos.secrets`       | Env + per-org vault get/put/delete → `/api/ext/secrets`                   |
| `agentos.notifications` | Notify / recent / delivery → `/api/ext/notifications`                     |
| `agentos.oauth`         | Provider-agnostic authorize URL + code exchange; vault tokens via secrets |
| `agentos.webhook`       | HMAC signature verify, timestamp skew, idempotency (`cache_store`)        |
| `agentos.vector_store`  | Embedding upsert / query → `/api/ext/vector-store`                        |
| `agentos.worker`        | Concurrency + timeout for `meta.json` `api.kind: "worker"` (ticket 80)    |

### Domain → import path (TS + Python)

| Domain        | TS                                | Python                  |
| ------------- | --------------------------------- | ----------------------- |
| files         | `@agentos/core/api/files`         | `agentos.files`         |
| events        | `@agentos/core/api/events`        | `agentos.events`        |
| audit         | `@agentos/core/api/audit`         | `agentos.audit`         |
| secrets       | `@agentos/core/api/secrets`       | `agentos.secrets`       |
| notifications | `@agentos/core/api/notifications` | `agentos.notifications` |

Gateway base: `AGENT_OS_GLOBAL_GATEWAY_URL` (default `http://127.0.0.1:5173`). Per-builtin overrides: `AGENT_OS_AUTH_API_BASE`, `AGENT_OS_DB_STORE_API_BASE`, `AGENT_OS_CACHE_STORE_API_BASE`, `AGENT_OS_AI_API_BASE`, `AGENT_OS_HITL_API_BASE`, `AGENT_OS_FILES_API_BASE`, `AGENT_OS_EVENTS_API_BASE`, `AGENT_OS_AUDIT_API_BASE`, `AGENT_OS_SECRETS_API_BASE`, `AGENT_OS_NOTIFICATIONS_API_BASE`.

Org-scoped clients (`secrets`, `notifications`, `vector_store`, `store`) accept `org_id=` / `X-AgentOS-Org-Id` (and optional forwarded headers) so error shapes and auth headers stay consistent with `@agentos/core/api/*`.

## Example

```python
from fastapi import Depends
from agentos import create_app, auth, store

app = create_app()

@app.get("/secure")
async def secure(session: auth.AuthSession = Depends(auth.require_session())):
    rows = await store.db_store.collection("invoices").query({"limit": 10})
    return {"user": session.user.id, "count": len(rows.items)}
```

Never open SQL/Redis from a service — use `agentos.store` HTTP clients only (ADR 004).

## Tests

```bash
uv run pytest
```
