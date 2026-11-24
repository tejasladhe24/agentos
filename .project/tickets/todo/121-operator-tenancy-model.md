# 121 — Operator tenancy model (deployment operators + single-org customers)

**Status:** todo

## Goal

Match tenancy to how AgentOS is delivered: **one deployment per client**. Inside a deployment:

- **Operators** — the client's staff. Deployment-wide: create customer orgs, enter any org, and own **all org settings**.
- **Customer users** — belong to **exactly one org** (their company). They use the app; a **customer admin** may manage their own colleagues and roles, but never org settings.

Covers both delivery cases with one model:

| Client type                                                                    | Operators    | Orgs                   |
| ------------------------------------------------------------------------------ | ------------ | ---------------------- |
| Serves its own customers (bookkeeping firm, staffing agency, property manager) | Client staff | One per customer       |
| Wants an internal tool                                                         | Client staff | One: the client itself |

## Depends on

- Ticket **71** / **75** (org tenancy, role admin API) — done
- Ticket **101** (extension-registered Settings) — done
- Ticket **103**–**114** (integrations + mounts settings to re-gate) — done

## Today

- Roles are **per org only** (`owner`, `admin`, `viewer`, …); no deployment-wide authority.
- Any signed-in user can `POST /orgs` and becomes that org's `owner` with `*`.
- Users can belong to many orgs and switch via `POST /orgs/switch`.
- Public `/register` sign-up is open; there is **no invite flow**.
- Org settings (integrations, storage mounts, retention, roles) are gated by org-level permissions (`integrations.manage`, `auth.roles.manage`, …) that an org owner holds.

## Scope

### 1. Operator role (deployment-wide)

- New user-level flag/role `operator` stored in auth (not an `org_members` row).
- Bootstrap: first user on a fresh deployment becomes operator (or `AGENT_OS_EXT_AUTH_BOOTSTRAP_OPERATOR_EMAIL`). Operators can promote/demote other operators; the last operator cannot be removed.
- Session exposes `isOperator`. `@agentos/core/api/auth` + Python `agentos.auth` gain `requireOperator()`.

### 2. Orgs created by operators only

- `POST /orgs` restricted to operators; creates an org **for a customer** (operator is not auto-added as a member).
- Operators can list all orgs, rename, suspend/archive (archived orgs block sign-in for their members).
- Operators can **enter** any org (acting as that org) without being a member; every enter/exit and every action while entered is audited with the operator's identity.

### 3. Customer users: exactly one org

- A non-operator user belongs to one org. Org switcher and "create org" are hidden for them; `POST /orgs/switch` rejects non-operators.
- Org-level roles for customers: `customer_admin`, `member`, `viewer` (extendable via the existing role → permission maps).
- `customer_admin` may invite/remove users and assign customer roles **within their org only**. They cannot grant operator, cannot touch org settings.

### 4. Invitations + sign-up policy

- Invite flow: operator or customer admin invites an email to an org with a role → signed, expiring invite link (email via notifications) → accept creates/links the account and joins that org.
- `agentos.config.ts` `auth.signUp: 'invite-only' | 'open'` (default `invite-only` for client deployments). In invite-only mode `/register` only works with a valid invite token.
- SSO: domain → org mapping for customer SSO is configured by operators (builds on ticket **75**).

### 5. Settings visibility (personal vs org vs deployment)

- `meta.json` `settings[]` gains `scope: 'personal' | 'org' | 'deployment'`.
  - `personal` (profile, password, My connected drives): every user.
  - `org` (integrations: email/SMS/AI, storage mounts, bin retention, org roles): **operators only**, applied to the org selected in an **org picker** at the top of Settings.
  - `deployment` (operators list, org list, sign-up policy): operators only.
- Customer admins get a **Members** section (invite / remove / roles) — the only org-level surface they see.
- Re-gate APIs: `integrations.manage`, files mount management, retention, role→permission edits require operator. Member management requires operator or `customer_admin` of that org.

### 6. Migration for existing deployments

- Existing users with `owner` / `admin` in any org → operators (configurable), or keep as `customer_admin` of their org when `AGENT_OS_EXT_AUTH_MIGRATE_OWNERS=customer_admin`.
- Users in multiple orgs: operators keep access to all; non-operators keep their current active org and are removed from the rest (logged), or the migration fails loudly listing them, selected by flag.
- Demo seed: `admin@example.com` = operator; `viewer@example.com` = member of the demo org.

## Out of scope

- Self-serve sign-up that creates a new org (SaaS mode) — possible later as `auth.signUp: 'open-with-org'`.
- Billing / plan limits per org.

## Done when

- [ ] Operator role with bootstrap, promote/demote, last-operator guard
- [ ] Only operators create, archive, and enter orgs; entering is audited
- [ ] Non-operators belong to exactly one org; no switcher or create-org for them
- [ ] `customer_admin` manages members and roles of their own org only
- [ ] Invite flow + invite-only sign-up policy in `agentos.config.ts`
- [ ] Settings `scope` (personal / org / deployment) with operator org picker; APIs re-gated
- [ ] Migration path for existing deployments + updated demo seed
- [ ] Tests: customer cannot create/switch orgs or read/write integrations; customer admin cannot act outside their org; operator enter is audited; invite accept joins the right org
- [ ] Docs: `concepts.md` tenancy rule rewritten (deployment = client, org = client's customer, operator vs customer roles); `builtins.md` auth section
- [ ] `bun run ci` green

## Verify

- Fresh deployment: first sign-up is operator → creates org "Acme" → invites `jane@acme.com` as `customer_admin` → Jane accepts, sees no org switcher or org settings, invites a colleague
- Jane calls `PUT /integrations/...` → 403; operator picks Acme in Settings → configures Acme's email key
- Internal-tool deployment: operator creates one org for the company; staff are invited into it
