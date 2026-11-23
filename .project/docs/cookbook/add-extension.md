# Cookbook — Add a Bun/TS extension

1. Create `examples/client-app/extensions/my-feature/`.
2. Add `meta.json` with `"api.language": "bun"`, a free port, and optional `"icon"` (Phosphor basename, e.g. `"Users"` — see `extensions.md`). To also link a Python service from the same extension, add a sibling `service` block (see [extensions.md](../extensions.md#metajson-bun-api--linked-python-service) / [add-python-service](./add-python-service.md)).
3. Add UI as needed: `ui/page.tsx` and/or `sidebar.tsx` / `widget.tsx` using `@agentos/core/client` for host hooks and `@agentos/ui` (shadcn) for buttons/inputs/selects/etc. — not native HTML controls. App Home content lives at app-level `ui/dashboard.tsx` (passed to `mountShell`), not inside the extension.
4. Add `agent/tools.json` / `skills.ts` / `instructions.md` as needed.
5. Add routes under `api/routes/**/index.ts` using `@agentos/core/api/*`.
6. Run `agentos dev` (Bun). Confirm registry lists the extension and UI mounts.

Do **not** open a database from the API — use `dbStore` from `@agentos/core/api/store`.
