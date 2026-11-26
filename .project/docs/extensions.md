# Extensions

An **extension** is a feature unit discovered by convention.

## Layout

```text
extensions/<id>/
  meta.json
  ui/
    page.tsx          # main slot → /ext/<id>
    sidebar.tsx       # left sidebar (shown when this extension is activeView)
    right-sidebar.tsx # right sidebar (resizable, shown when open + extension is activeView)
    right-sheet.tsx   # global right sheet (overlay; TopBar trigger, any workspace page)
    widget.tsx        # home widget card(s)
    settings.tsx      # Settings sidebar section(s) (paired with meta.json settings)
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

## Right sidebar vs right sheet

Both are optional iframe entrypoints, but they live in different Shell hosts:

| File                   | Host                                                        | Visibility                                                            | Controlled by                                                                                       |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ui/right-sidebar.tsx` | Inline resizable column beside the workspace                | Only while the **active** extension is open and the column is open    | TopBar right-sidebar toggle, `useHostUi().setRightSidebarOpen`                                      |
| `ui/right-sheet.tsx`   | Global `@agentos/ui` `Sheet` (`side="right"`) over any page | Any time the user opens it from the TopBar trigger for that extension | TopBar trigger per extension, `useHostUi().openRightSheet` / `closeRightSheet` / `toggleRightSheet` |

- Optional `meta.json` `rightSheet: { label?, description?, icon? }` sets the TopBar tooltip and icon and the Sheet header. Missing fields fall back to the extension `name` and `icon`.
- Use `right-sidebar` for context tied to the page you are on (for example Files details). Use `right-sheet` for a workspace-wide panel (for example notifications) that should stay reachable from Home, Settings, and other extensions.
- Only one right sheet is open at a time. Disabling the extension that owns the open sheet closes it. A sheet frame mounts the first time its sheet opens and stays mounted while the sheet is closed, so reopening does not re-run the extension handshake.
- `openRightSheet(extensionId?)`, `toggleRightSheet(extensionId?)`, and `getActiveRightSheet()` default to the calling extension. A missing or disabled `right-sheet` contribution is a no-op.

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

## meta.json (Bun API + linked Python service)

One extension may declare **both** a Bun `api/` and a Python service (ticket **83**). Keep Bun as the primary gateway face; put the Python link in a sibling `service` block:

```json
{
  "name": "Questionnaires",
  "icon": "ClipboardText",
  "api": {
    "language": "bun",
    "port": 6201,
    "routesDir": "api/routes"
  },
  "service": {
    "root": "../../services/questionnaires",
    "port": 6211,
    "health": "/health",
    "kind": "http",
    "mount": "/_service"
  }
}
```

| Field           | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `service.root`  | Path to `services/<id>/`, relative to the extension directory                                  |
| `service.port`  | Python uvicorn port (must differ from `api.port`)                                              |
| `service.mount` | Gateway prefix under `/api/ext/:id` (default `/_service`); stripped before forwarding upstream |
| `service.kind`  | `http` (default) or `worker` — same as python-only `api.kind`                                  |

Gateway routing:

- `/api/ext/<id>/*` → Bun (`api.port`)
- `/api/ext/<id>/_service/*` → Python (`service.port`), mount stripped (so `/_service/health` → `/health`)

`agentos dev` / `start` boots both processes; the Python child is named `<id>:service` so log prefixes do not collide with the Bun API.

Do **not** combine `api.language: "python"` with a top-level `service` — use `api.root` for python-only extensions. Public portals (`public.apiPrefixes`) stay Bun-facing unless a prefix falls under `mount`.

Optional `icon` is a Phosphor icon basename (`"Users"` → `UsersIcon`) for Activity Bar and Extension Manager. Unknown or missing values fall back to `Cube`. Curated names live in `@agentos/core` `resolveExtensionIcon` / `EXTENSION_ICON_MAP`.

### Activity Bar sections

Optional `activityBarSection` is `"primary"` (default) or `"secondary"`:

| Section       | Placement                                   | Who may use it                                                  |
| ------------- | ------------------------------------------- | --------------------------------------------------------------- |
| **primary**   | Top of the Activity Bar, icons top → bottom | Customer extensions with a `ui/page` (and builtins that opt in) |
| **secondary** | Bottom of the bar, stacked bottom → top     | **Builtins only**                                               |

Customer `meta.json` that sets `"activityBarSection": "secondary"` is coerced to **primary** when the registry is applied to the Shell. Builtins such as **auth** (page iframe) and **hitl** (Approvals page at `/ext/hitl`) register secondary; Extension Manager remains Shell chrome in the secondary cluster (page at `/extensions`).

### Home dashboard (app-level)

The consumer app owns **`ui/dashboard.tsx`** next to `extensions/` and `services/` — not inside an extension. Pass it into `mountShell(root, { dashboard })`. Shell renders it in-process in the Home pane (`activeView === 'home'`). Optional extension `ui/widget.tsx` cards still appear in a grid below when present. Without a dashboard option, Home shows a minimal empty placeholder.

Optional **`ui/dashboard-sidebar.tsx`** is the Home sidebar entrypoint — also in-process via `mountShell(root, { dashboardSidebar })`. It is **not** a `UiViewName` / extension iframe.

### Sidebar hosts (active-extension)

Shell UI contribution hosts are either **active-extension** or **global**:

| Host kind            | Example            | Shows                                                                                                                | When empty                           |
| -------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Active-extension** | Left sidebar       | Only the active extension’s `ui/sidebar.tsx`, or Home’s `dashboardSidebar`                                           | Column **collapses** — no empty pane |
| **Active-extension** | Right sidebar      | Only the active extension’s `ui/right-sidebar.tsx` (resizable; defaults closed, toggled via TopBar or `useHostUi()`) | Column **collapses** — no empty pane |
| **Global**           | Status bar, topbar | May aggregate all enabled extensions (topbar v1 is Shell chrome: sidebar toggles, branding)                          | May stay visible with Shell chrome   |

`ui/sidebar.tsx` mounts in the Shell’s left column and `ui/right-sidebar.tsx` mounts in the Shell’s right column. Only the **active** extension’s sidebar is visible (`activeView === extensionId`). Home without `dashboardSidebar`, or an extension without `ui/sidebar.tsx` / `ui/right-sidebar.tsx`, collapses that column.

Opening **Extensions** (admin only, `/extensions`) or **Approvals** (`/ext/hitl`) from the Activity Bar (secondary) navigates to a full page in the main canvas. Neither opens as a left-sidebar overlay. Extensions can open, close, or toggle the right sidebar via `useHostUi()` (`@agentos/core/client`).

## Cross-extension access (`dependsOn` and host capabilities)

An extension UI talks to its **own** API through `useHostApi().fetch('/path')`. It must not reach into other extensions' routes. Two sanctioned ways exist:

1. **Host capabilities** for shared platform needs — the Shell calls the builtin on the UI's behalf, so UI code carries no `/api/ext/<other>/…` strings:

   | Capability                                                                   | Replaces                                                                                                              |
   | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
   | `useHostAuth().can(permission)`                                              | `POST /api/ext/auth/permissions/check`. Cached per session; `false` when signed out; rejects when auth is unreachable |
   | `useHostNotifications().send(input)`                                         | `POST /api/ext/notifications/notify`                                                                                  |
   | `useHostNotifications().getEmailPreferences()` / `setEmailPreferences(from)` | `/api/ext/notifications/preferences/email`                                                                            |
   | `useHostFiles().blobUrl(key)` / `useFilesBlobUrl(key)`                       | `/api/ext/files/blobs/<key>`                                                                                          |

2. **Declared dependency** for anything without a capability: list the other extension in `meta.json` and build the path with `extensionPath(id, path)` from `@agentos/core/client`.

   ```json
   { "dependsOn": ["notifications"] }
   ```

   ```tsx
   const res = await api.fetch(
     extensionPath('notifications', '/deliveries?limit=50'),
   );
   ```

**Enforcement.** `host.api.fetch` forwards an absolute `/api/ext/<id>/…` path only when `<id>` is the calling extension or is listed in its `dependsOn`; anything else resolves with status **403** and never reaches the network. Reactions to another extension's activity should use a declared bus event (see below) rather than polling its routes. A guard test fails the build if a builtin UI hardcodes `/api/ext/<other>/…` without declaring it.

## Event bus (extension UI ↔ extension UI)

Extension UIs never talk to each other directly: no `BroadcastChannel`, no `window.postMessage` between frames, no cross-extension `api.fetch`. The **Shell is the broker** — frames register subscriptions with it and it fans events out through each frame's `ExtensionAPI.onEvent` (ADR 005 channels; frames never see each other's ports).

**Declare topics in `meta.json`** — the Shell rejects undeclared publishes and subscribes:

```json
{
  "events": {
    "publishes": ["files.selection.changed"],
    "subscribes": ["email.received", "hitl.resolved"]
  }
}
```

- Topics are namespaced `<extId>.<event>` and match `^[a-z0-9][a-z0-9._-]*$` (max 128).
- `publishes` must start with the extension's own id (`files.…` for `files`); the scanner drops anything else with a warning. `subscribes` may name any topic, including platform topics (`email.received`, `hitl.resolved`).
- Payloads are JSON (`EventPayload`).

**From UI code** (`@agentos/core/client`):

```tsx
const { publishLocal } = useHostPublish();
useHostEvent('email.received', (payload) => {
  /* … */
});
await publishLocal('files.selection.changed', { keys }); // in-process
```

| API                                    | Path                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `events.publishLocal` / `publishLocal` | UI-only: the Shell delivers in-process to subscribed frames. No server round trip, not durable, not seen by other tabs.                         |
| `events.publish` / `publish`           | Durable: `POST /api/ext/events/publish` (org-scoped, ticket 141). It reaches UI subscribers (this and other tabs) through the SSE bridge below. |
| `events.subscribe` / `useHostEvent`    | Registers the calling frame for declared topics; returns a subscription id. Frame disposal drops its subscriptions automatically.               |

**`host.storage` is session-only.** It is shared by all frames of one extension and cleared on reload or sign-out (the Shell has no org/user scope to key browser storage by). `useHostSharedState` therefore syncs frames within a session; it does not remember values across reloads. Persist durable data through the extension's API (db-store).

**Shared state across an extension's frames** (page + sidebar + right sidebar, …): use `useHostSharedState(key, initial, { topic, parse })`. It keeps the value in (session-only) host storage, announces each change on `topic`, and updates every other frame live — the replacement for per-feature `BroadcastChannel` hooks (a guard test fails the build if `BroadcastChannel` reappears under an extension's `ui/`). Declare `topic` under both `events.publishes` and `events.subscribes`.

```tsx
const [section, setSection] = useHostSharedState('email.section', 'inbox', {
  topic: 'inbound-email.section.changed',
  parse: parseEmailSection,
});
```

Local publishes skip the publishing frame (the SDK notifies that frame's own subscribers directly), and subscribers read the stored value only after their subscription is registered, so no update is lost in between.

**Server events:** the Shell keeps **one** `GET /api/ext/events/subscribe` SSE connection per session, opened only while some frame is subscribed and closed when the last one leaves. The `events` builtin scopes it to the signed-in org, and the Shell re-emits each message on the in-memory bus to frames that declared the topic. Host implementation: `packages/core/src/shell/lib/chrome/event-bus.ts` and `events-bridge.ts`.

## Frame lifecycle and theme

- **Lazy mount.** `ExtensionFrame` renders nothing (no iframe, no `src` request, no handshake) until the frame is first visible. After that it stays mounted when parked, so switching views never remounts it. A hidden extension's frame therefore has no live `onEvent` subscription: read durable state on mount (`useHostSharedState` does) instead of relying on having seen every past event.
- **Theme without reload.** `?theme=` seeds the first load only. When the app theme changes the Shell sends every live frame the host event `shell.theme.changed` (`HOST_THEME_TOPIC`, payload `{ theme }`); `HostProvider` re-applies the `<html>` theme class. The iframe `src` never changes, so nothing reloads or re-handshakes.
- **Approval waits.** `host.hitl.requestApproval` waits for `hitl.resolved` from the bus, with one immediate lookup and a 5 s single-record `GET /api/ext/hitl/approvals/:id` fallback (never the list endpoint). The Approvals page refreshes on `hitl.requested` / `hitl.resolved` and keeps only a 30 s visible-tab fallback poll. The `hitl` builtin scopes these events to the actor's org from the session cookie; callers without a session (agents, scripts) publish platform-scoped events that browsers do not receive, which is why the fallback poll exists.

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

Import `@agentos/core/client` for host SDK hooks (`HostProvider`, `useHostStorage`, `useHostAI`, `useHostHITL`, `useHostNotifications`, `useHostApi`, `useHostNavigation`, `useHostEvent`, `useHostPublish`, `useHostSharedState`, `useHostAuth`, `useHostFiles`). Iframes are sandboxed without popups or top navigation, so open external pages (OAuth consent, "Open in Google") with `useHostNavigation().openExternal(url, { sameTab? })`; the Shell accepts only absolute `http(s)` URLs. **`@agentos/core/client` is for `ui/*.tsx` only** — never import it from `api/routes/**` or Python services (use `@agentos/core/api/*` / `agentos.*` there). For base controls (buttons, inputs, checkboxes, selects, dropdowns, …) import from **`@agentos/ui/components/*`** (shadcn) — do not use native HTML controls unless specifically required. Views are wrapped by framework iframe bootstrap — no Comlink / handshake boilerplate in FDE code.

## Builtins

Same folder conventions under `packages/core/builtins/<id>/`, with `driven: true`.
