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

## SDK

Use the **`agentos`** Python package (`packages/python`):

- `agentos.auth` — session + RBAC Depends
- `agentos.store` — db/cache clients → builtins
- `agentos.ai`, `agentos.hitl`, …

Never open SQL/Redis from the service; call builtins via the kit.

## Process

Started by `agentos dev` (with Vite) and `agentos start` (production, no Vite) with uvicorn/uv alongside Bun APIs.
