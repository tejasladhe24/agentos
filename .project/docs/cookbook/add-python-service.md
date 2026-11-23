# Cookbook — Add a Python service for an extension

1. Keep UI/agent under `extensions/my-feature/` (TypeScript only).
2. Create `services/my-feature/` with FastAPI + `pyproject.toml`.
3. Depend on the `agentos` Python package; use `agentos.auth` / `agentos.store` / etc.
4. Link from `extensions/my-feature/meta.json`:
   - **Python-only:** `"api.language": "python"`, `"root": "../../services/my-feature"`, `"port": …`.
   - **Bun + Python (dual):** keep `"api.language": "bun"` and add a sibling `"service": { "root", "port", "mount": "/_service" }` — see [extensions.md](../extensions.md#metajson-bun-api--linked-python-service).
5. `agentos dev` / `agentos start` boot uvicorn for each linked service and proxy:
   - Python-only → `/api/ext/<id>/*`
   - Dual → `/api/ext/<id>/_service/*` (Bun keeps the rest of `/api/ext/<id>/*`)

Do **not** put Python packages inside `extensions/my-feature/`.
