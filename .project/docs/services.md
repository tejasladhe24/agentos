# Services (Python)

A **service** is a standalone Python backend for an extension. It does **not** live inside `extensions/<id>/`.

## Why separate?

Mixing FastAPI trees with React/`tsx` in one folder hurts packaging, IDE support, and reviews. The extension keeps UI + agent declarations; the service is its own package.

## Layout

```text
services/<id>/
  pyproject.toml
  app/
    main.py
    routes/...
```

Linked from:

```json
// extensions/<id>/meta.json
{
  "api": {
    "language": "python",
    "root": "../../services/<id>",
    "port": 6102
  }
}
```

## HTTP vs worker

| `api.kind`       | Role                                                 | Supervisor                        |
| ---------------- | ---------------------------------------------------- | --------------------------------- |
| `http` (default) | Request/response FastAPI                             | Logged as python HTTP service     |
| `worker`         | Long jobs (crawls, scrapes) with concurrency/timeout | Logged as **worker**; injects env |

Worker example (ChannelGuard-oriented):

```json
{
  "api": {
    "language": "python",
    "kind": "worker",
    "root": "../../services/crawler",
    "port": 6601,
    "health": "/health",
    "concurrency": 1,
    "timeoutSeconds": 300
  }
}
```

`agentos dev` / `agentos start` still launch uvicorn (`app.main:app`) so `/health` and job-trigger routes stay gateway-proxied (`/api/ext/<id>/*`). For workers they also set:

| Env                               | From meta            | Read by          |
| --------------------------------- | -------------------- | ---------------- |
| `AGENT_OS_WORKER_CONCURRENCY`     | `api.concurrency`    | `agentos.worker` |
| `AGENT_OS_WORKER_TIMEOUT_SECONDS` | `api.timeoutSeconds` | `agentos.worker` |

Wrap long jobs:

```python
from agentos import create_app, worker

app = create_app()

@app.post("/crawl")
async def crawl() -> dict[str, bool]:
    async def job() -> None:
        ...  # Playwright, etc.

    await worker.run_job(job)
    return {"ok": True}
```

Scheduler jobs (ticket **74**) can `POST` the trigger URL; until then, call the route manually or via host cron.

### Headless browser image

Do not put Chromium in the default root [`Dockerfile`](../../Dockerfile). For browser workers, use the fragment [`deploy/docker/Dockerfile.playwright.fragment`](../../deploy/docker/Dockerfile.playwright.fragment) (OS libs) plus `playwright install chromium` in the service image.

### Egress / proxy (MVP)

Optional standard proxy env (rotation / residential pools are **out of scope** for MVP):

| Env                          | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `HTTP_PROXY` / `HTTPS_PROXY` | Outbound crawl traffic via a fixed proxy                        |
| `NO_PROXY`                   | Bypass list (gateway, builtins, localhost)                      |
| `PLAYWRIGHT_PROXY_SERVER`    | Playwright-specific proxy URL when not using process-wide proxy |

Document required allowlists with the site owner; do not scrape third-party retailers without permission (ChannelGuard MVP uses mock storefronts / sandboxes only).

## SDK

Use the **`agentos`** Python package (`packages/python`):

- `agentos.auth` — session + RBAC Depends
- `agentos.store` — db/cache clients → builtins
- `agentos.ai`, `agentos.hitl`, …
- `agentos.worker` — concurrency + timeout for `kind: "worker"`

Never open SQL/Redis from the service; call builtins via the kit.

## Process

Started by `agentos dev` (with Vite) and `agentos start` (production, no Vite) with uvicorn/uv alongside Bun APIs.
