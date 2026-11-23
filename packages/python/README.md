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

| Module               | Role                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| `agentos.create_app` | FastAPI factory with `GET /health` → `{ "ok": true }`                     |
| `agentos.auth`       | Session + RBAC `Depends` → gateway `/api/ext/auth`                        |
| `agentos.store`      | `db_store` / `cache_store` → db-store / cache-store builtins              |
| `agentos.ai`         | Text/image/embed/chat → `/api/ext/ai`                                     |
| `agentos.hitl`       | Approvals → `/api/ext/hitl`                                               |
| `agentos.oauth`      | Provider-agnostic authorize URL + code exchange; vault tokens via secrets |
| `agentos.webhook`    | HMAC signature verify, timestamp skew, idempotency (`cache_store`)        |
| `agentos.worker`     | Concurrency + timeout for `meta.json` `api.kind: "worker"` (ticket 80)    |

Gateway base: `AGENT_OS_GLOBAL_GATEWAY_URL` (default `http://127.0.0.1:5173`). Per-builtin overrides: `AGENT_OS_AUTH_API_BASE`, `AGENT_OS_DB_STORE_API_BASE`, `AGENT_OS_CACHE_STORE_API_BASE`, `AGENT_OS_AI_API_BASE`, `AGENT_OS_HITL_API_BASE`.

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
