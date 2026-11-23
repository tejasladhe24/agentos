# Extensions

An **extension** is a feature unit discovered by convention.

## Layout

```text
extensions/<id>/
  meta.json
  ui/
    page.tsx       # main slot → /ext/<id>
    sidebar.tsx    # left sidebar (shown when this extension is activeView)
    widget.tsx     # home widget card(s)
  agent/
    tools.json     # tool schemas → HTTP
    skills.ts      # /slash skills
    instructions.md
  api/             # optional — Bun only
    env.ts         # optional — export `keys` (Zod schemas)
    server.ts
    routes/
      tools/
        search_contacts/index.ts
```

## Env (`api/env.ts`)

Each extension exports a `keys()` factory that returns a `@t3-oss/env-core` `createEnv` instance. The app extends those instances — no custom merge helper.

```ts
// extensions/crm/api/env.ts
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = (runtimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_CRM_API_TOKEN: z.string().min(1),
    },
    clientPrefix: 'AGENT_OS_EXT_CRM_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_CRM_API_TOKEN: runtimeEnv.AGENT_OS_EXT_CRM_API_TOKEN,
    },
    emptyStringAsUndefined: true,
  });
// Always set: server, client, clientPrefix, runtimeEnv
```

| Scope             | Pattern                       | Example                    |
| ----------------- | ----------------------------- | -------------------------- |
| Global / platform | `AGENT_OS_GLOBAL_<VAR>`       | `AGENT_OS_GLOBAL_NODE_ENV` |
| Extension         | `AGENT_OS_EXT_<DOMAIN>_<VAR>` | `AGENT_OS_EXT_AUTH_SECRET` |

Domain = extension id uppercased with `-` → `_` (`db-store` → `DB_STORE`).

**Production auth (builtin):** set `AGENT_OS_EXT_AUTH_SECRET` (≥32 chars, no default), `AGENT_OS_GLOBAL_APP_ORIGIN` (Shell HTTPS origin), and `AGENT_OS_EXT_AUTH_BASE_URL` (public auth API URL). With `AGENT_OS_GLOBAL_NODE_ENV`/`NODE_ENV=production`, demo users are not seeded (override with `AGENT_OS_EXT_AUTH_SEED_DEMO=true|false`). See [builtins.md](./builtins.md#auth-production-env).

```ts
import { createEnv } from '@t3-oss/env-core';
import { platformKeys } from '@agentos/core/api/env';
import { keys as authKeys } from '@agentos/core/builtins/auth/env';
import { keys as crmKeys } from '@extensions/crm/api/env';

export const env = createEnv({
  extends: [platformKeys(), authKeys(), crmKeys()],
  server: {},
  clientPrefix: 'AGENT_OS_APP_CLIENT',
  client: {},
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});
```

Every `createEnv` / `keys()` call must define `server`, `client`, `clientPrefix`, and `runtimeEnv`.

Server-side only — never put secrets in `@agentos/core/client` / iframe UI.

## meta.json (Bun API)

```json
{
  "name": "CRM Helper",
  "icon": "Users",
  "api": {
    "language": "bun",
    "port": 6101,
    "routesDir": "api/routes"
  }
}
```

## Public (unauthenticated) routes

TrustDesk trust centers, CloseDesk client links, and similar portals need SPA
paths and API routes that work **without** a Better Auth session — but must
not be a wide-open bypass. Declare them on the extension:

```json
{
  "name": "Demo",
  "api": { "language": "bun", "port": 6103 },
  "public": {
    "ui": [{ "path": "/p/demo", "view": "page" }],
    "apiPrefixes": ["/portal/"]
  }
}
```

| Field                    | Meaning                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.ui[].path`       | SPA pathname AuthGate admits without login (exact, or prefix with `/*`)                                                                                       |
| `public.ui[].view`       | Extension view to iframe (`page` default)                                                                                                                     |
| `public.apiPrefixes`     | Upstream path prefixes (after `/api/ext/:id`) that accept public tokens                                                                                       |
| `public.openApiPrefixes` | Prefixes that skip session **and** public-token gates (OAuth callbacks, inbound webhooks — ticket 78). Handlers must verify signed `state` / HMAC themselves. |

**Shell:** AuthGate renders a minimal portal host (branding + iframe to
`/__agentos/ext/<id>/<view>.html`) and forwards `?token=`. No Activity Bar /
Cmd+K. Unknown paths stay Not Found; only `/` still redirects to `/login`.

**API kit:** When `apiPrefixes` and/or `openApiPrefixes` is set, pass them into `createApp`:

```ts
import { createApp, loadRoutes } from '@agentos/core/api';

const app = createApp({
  publicApiPrefixes: ['/portal/'],
  openApiPrefixes: ['/oauth/callback', '/webhooks/'],
});
await loadRoutes(app, `${import.meta.dir}/routes`);
```

- `GET /health` stays open
- Paths under an **open** prefix skip auth (verify OAuth `state` or webhook HMAC in the handler)
- Paths under a **public** prefix require a signed token (`Authorization: Bearer` or `?token=`)
- All other routes require a session (401 without cookie)

**Tokens:** Mint short-lived HMAC links with `@agentos/core/api/public-token`:

```ts
import { signPublicToken } from '@agentos/core/api/public-token';

const token = await signPublicToken({
  orgId, // bind to tenant (ticket 71)
  extensionId: 'demo',
  purpose: 'portal',
  pathPrefix: '/portal/',
  ttlSeconds: 3600,
  // optional: role: 'external_viewer' — default from purpose
});
// Share: `${AGENT_OS_GLOBAL_APP_ORIGIN}/p/demo?token=${token}`
```

Tokens carry a limited **`role`** (default `external_viewer` for `portal` /
`trust-center` / `client-link` purposes). Use `resolvePublicTokenRole(payload)`
or `getPublicAccess(c)?.role` when a portal handler needs RBAC-style checks
without a Better Auth session.

Set `AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET` (≥16 chars) in platform env. Prefer
expiring signed links over anonymous cookies. Public handlers read
`getPublicAccess(c)` and pass `orgId` into `dbStore.collection(name, { orgId })`.

### OAuth connect + inbound webhooks (ticket 78)

Third-party integration OAuth (QuickBooks, Xero, Bullhorn, …) is **not** Better
Auth SSO. Use the Bun kit:

```ts
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  persistOAuthTokens,
  signOAuthState,
  toStoredTokens,
  verifyOAuthState,
} from '@agentos/core/api/oauth';
import {
  verifyAndHandleWebhook,
  WebhookVerifyError,
} from '@agentos/core/api/webhook';
```

- **Start** (`GET …/oauth/connect`): `requireOrg` → `signOAuthState` + `buildAuthorizeUrl` (optional PKCE).
- **Callback** (`GET …/oauth/callback`): declare under `openApiPrefixes` → `verifyOAuthState` → `exchangeAuthorizationCode` → `persistOAuthTokens` (secrets vault, ticket 77).
- **Webhook** (`POST …/webhooks/…`): `openApiPrefixes` → `verifyAndHandleWebhook` (HMAC + skew + `cacheStore` idempotency).

Provider client ids/scopes stay in the extension. Example stubs live in
`examples/client-app/extensions/demo/api/routes/{oauth,webhooks}/`.
Python services: `agentos.oauth` / `agentos.webhook` (same contracts).

Signing secret: `AGENT_OS_GLOBAL_OAUTH_STATE_SECRET` (falls back to
`AGENT_OS_GLOBAL_PUBLIC_LINK_SECRET`).

## meta.json (Python service)

```json
{
  "name": "Invoice Bot",
  "icon": "Receipt",
  "api": {
    "language": "python",
    "root": "../../services/invoice-bot",
    "port": 6102,
    "health": "/health"
  }
}
```

Optional `icon` is a Phosphor icon basename (`"Users"` → `UsersIcon`) for Activity Bar and Extension Manager. Unknown or missing values fall back to `Cube`. Curated names live in `@agentos/core` `resolveExtensionIcon` / `EXTENSION_ICON_MAP`.

### Activity Bar sections

Optional `activityBarSection` is `"primary"` (default) or `"secondary"`:

| Section       | Placement                                   | Who may use it                                                  |
| ------------- | ------------------------------------------- | --------------------------------------------------------------- |
| **primary**   | Top of the Activity Bar, icons top → bottom | Customer extensions with a `ui/page` (and builtins that opt in) |
| **secondary** | Bottom of the bar, stacked bottom → top     | **Builtins only**                                               |

Customer `meta.json` that sets `"activityBarSection": "secondary"` is coerced to **primary** when the registry is applied to the Shell. Builtins such as **auth** (page iframe) and **hitl** (Approvals inbox chrome) register secondary; Extension Manager remains Shell chrome in the secondary cluster.

### Home dashboard (app-level)

The consumer app owns **`ui/dashboard.tsx`** next to `extensions/` and `services/` — not inside an extension. Pass it into `mountShell(root, { dashboard })`. Shell renders it in-process in the Home pane (`activeView === 'home'`). Optional extension `ui/widget.tsx` cards still appear in a grid below when present. Without a dashboard option, Home shows a minimal empty placeholder.

Optional **`ui/dashboard-sidebar.tsx`** is the Home sidebar entrypoint — also in-process via `mountShell(root, { dashboardSidebar })`. It is **not** a `UiViewName` / extension iframe.

### Left sidebar host (active-extension)

Shell UI contribution hosts are either **active-extension** or **global**:

| Host kind            | Example            | Shows                                                                                                     | When empty                           |
| -------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Active-extension** | Left sidebar       | Only the active extension’s `ui/sidebar.tsx`, or Home’s `dashboardSidebar`                                | Column **collapses** — no empty pane |
| **Global**           | Status bar, topbar | May aggregate all enabled extensions (topbar v1 is Shell chrome: sidebar toggle, branding, settings stub) | May stay visible with Shell chrome   |

`ui/sidebar.tsx` mounts in the Shell’s left column. Only the **active** extension’s sidebar is visible (`activeView === extensionId`). Home without `dashboardSidebar`, or an extension without `ui/sidebar.tsx`, hides the sidebar column.

Opening **Extensions** or **Approvals** from the Activity Bar (secondary) swaps that column to the Shell Extension Manager or HITL panel (mutually exclusive with contribution sidebars). These are left-sidebar panels, not right-edge sheets.

## Extension enable-state (durable)

Customer enable/disable toggles are stored in builtin **db-store** (collection `agentos_gateway`, doc `extension-enable`) — not Cloudflare KV. Vite (`agentos()`) and `agentos start` share the same load/save path; builtins stay locked.

- **Single replica:** safe — Map is process-local, rehydrated from db-store on boot; Shell also `GET /api/extensions/enable-state` on mount.
- **Multi-replica:** each process keeps its own Map cache for enable-state. Writes go to shared db-store, but other replicas can lag until restart/rehydrate. Keep `max_instances` / replicas at **1** until a later read-through or invalidation design. For shared **cache-store** KV (permissions, rate limits, fingerprints), set `AGENT_OS_EXT_CACHE_STORE_REDIS_URL` before scaling out.

```json
{
  "name": "Auth",
  "activityBarSection": "secondary",
  "api": { "language": "bun", "port": 6110 }
}
```

## File-based routes (Bun)

Wire the kit in `api/server.ts`, then place handlers under `api/routes/**/index.ts`.
Folder segments map to the path; `[param]` becomes `:param`. `createApp` registers
`GET /health` → `{ ok: true }` (override with `api/routes/health/index.ts` if needed).

```ts
// api/server.ts
import { createApp, loadRoutes } from '@agentos/core/api';

// Pass publicApiPrefixes when meta.json declares public.apiPrefixes (ticket 72).
const app = createApp();
await loadRoutes(app, `${import.meta.dir}/routes`);
Bun.serve({ port: 6101, fetch: app.fetch });
```

`api/routes/tools/search_contacts/index.ts` → `POST /tools/search_contacts`.
`api/routes/contacts/[id]/index.ts` → `GET /contacts/:id` (via `c.req.param('id')`).

```ts
import { requirePermissions } from '@agentos/core/api/auth';
import { dbStore } from '@agentos/core/api/store';
import type { RouteHandlers } from '@agentos/core/api';

export const middleware = [requirePermissions('crm.read')];

export const POST: RouteHandlers['POST'] = async (c) => {
  const input = await c.req.json();
  return c.json(await dbStore.collection('contacts').query(input));
};
```

## UI

Import `@agentos/core/client` for host SDK hooks (`HostProvider`, `useHostStorage`, `useHostAI`, `useHostHITL`, `useHostNotifications`, `useHostApi`). **`@agentos/core/client` is for `ui/*.tsx` only** — never import it from `api/routes/**` or Python services (use `@agentos/core/api/*` / `agentos.*` there). For base controls (buttons, inputs, checkboxes, selects, dropdowns, …) import from **`@agentos/ui/components/*`** (shadcn) — do not use native HTML controls unless specifically required. Views are wrapped by framework iframe bootstrap — no Comlink / handshake boilerplate in FDE code.

## Builtins

Same folder conventions under `packages/core/builtins/<id>/`, with `driven: true`.
