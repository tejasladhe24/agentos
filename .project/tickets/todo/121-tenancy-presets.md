# 121 — Tenancy presets: operators, org admins, and delivery types

**Status:** todo

## Goal

Make one codebase serve all three ways AgentOS is delivered, chosen per deployment in `agentos.config.ts`:

| Delivery type                         | Example                                      | Deployment                     | Orgs                                                 | Preset            |
| ------------------------------------- | -------------------------------------------- | ------------------------------ | ---------------------------------------------------- | ----------------- |
| **1. Your own product**               | You run "Slack" for end customers            | Yours, shared by all customers | Many; customers sign up and create their own         | `saas`            |
| **2. Client internal tool**           | A company's custom internal workspace        | Dedicated to the client        | One: the client itself                               | `internal`        |
| **3. Client customer-facing product** | A client runs a portal for its own customers | Dedicated to the client        | Many; one per client customer, created by the client | `customer-facing` |

Every deployment has the same two levels; presets only change who fills them and what is delegated:

|                     | Operator (whole deployment) | Org admin (one org)        | Org members             |
| ------------------- | --------------------------- | -------------------------- | ----------------------- |
| **saas**            | You                         | Customer's workspace admin | Customer's staff        |
| **internal**        | Client admins               | Same people (one org)      | Client's staff          |
| **customer-facing** | Client's staff              | Client customer's admin    | Client customer's staff |

## Depends on

- Ticket **71** / **75** (org tenancy, role admin API) — done
- Ticket **101** (extension-registered Settings) — done
- Ticket **103**–**114** (integrations and storage settings to gate) — done

## Today

- Roles are **per org only** (`owner`, `admin`, `viewer`, …); nobody has deployment-wide authority.
- Any signed-in user can `POST /orgs` and becomes that org's `owner` with `*`.
- Users can belong to many orgs and switch via `POST /orgs/switch`.
- Public `/register` sign-up is open; there is **no invite flow**.
- Org settings (integrations, storage mounts, retention, roles) are gated by org-level permissions (`integrations.manage`, `auth.roles.manage`, …) held by org owners/admins.

## Scope

### 1. Config + presets

`agentos.config.ts`:

```ts
tenancy: {
  preset: 'saas' | 'internal' | 'customer-facing',
  // presets fill these in; each can be overridden:
  orgs: 'single' | 'multi',
  signUp: 'open-creates-org' | 'invite-only',
  orgCreation: 'self-serve' | 'operators',
  orgSwitching: boolean,
  orgAdminCan: Array<'members' | 'integrations' | 'storage' | 'retention' | 'sso' | 'roles'>,
}
```

| Setting        | `saas`             | `internal`                 | `customer-facing`                      |
| -------------- | ------------------ | -------------------------- | -------------------------------------- |
| `orgs`         | `multi`            | `single`                   | `multi`                                |
| `signUp`       | `open-creates-org` | `invite-only` (or SSO)     | `invite-only`                          |
| `orgCreation`  | `self-serve`       | created at setup           | `operators`                            |
| `orgSwitching` | `true`             | `false`                    | `false` for non-operators              |
| `orgAdminCan`  | all                | all (admins are operators) | `['members']` (operators may add more) |

- Default preset when unset: `internal` for new client apps (safest), with a startup log line naming the active preset.
- Settings are validated at boot; invalid combinations fail fast (e.g. `orgs: 'single'` with `orgCreation: 'self-serve'`).

### 2. Operator role (deployment-wide)

- User-level `operator` role stored in auth (not an `org_members` row). Session exposes `isOperator`; `@agentos/core/api/auth` + Python `agentos.auth` gain `requireOperator()`.
- Bootstrap: first user on a fresh deployment becomes operator, or `AGENT_OS_EXT_AUTH_BOOTSTRAP_OPERATOR_EMAIL`. Operators promote/demote operators; the last operator cannot be removed.
- Operators can list all orgs, create, rename, suspend/archive (archived orgs block sign-in for members), and **enter** any org without being a member. Entering, leaving, and every action while entered are audited with the operator's identity.

### 3. Org lifecycle per preset

- `self-serve` (`saas`): sign-up creates a new org with the user as `org_admin`; users can be invited to other orgs and switch between them.
- `operators` (`customer-facing`): only operators create orgs, for a customer; operators are not auto-added as members.
- `single` (`internal`): one org created at setup; org creation and switching disabled; the org switcher is hidden everywhere.
- Non-operators in `customer-facing` belong to exactly one org; `POST /orgs/switch` rejects them.

### 4. Org roles + delegation

- Standard org roles: `org_admin`, `member`, `viewer` (extendable through existing role → permission maps). Existing `owner`/`admin` map to `org_admin`.
- Each org-settings area is an **admin capability**: `members`, `integrations` (email/SMS/AI keys), `storage` (mounts), `retention`, `sso`, `roles`.
- Permission check for an org-settings API: operator, **or** `org_admin` of that org **and** the capability is in `orgAdminCan`.
- Re-gate existing APIs: integrations routes (`integrations.manage`), files mount management, bin retention, role → permission edits, member management.

### 5. Invitations + sign-up policy

- Invite flow: operator or an `org_admin` with `members` invites an email to an org with a role → signed, expiring invite link sent via notifications → accepting creates/links the account and joins that org.
- `invite-only`: `/register` works only with a valid invite token. `open-creates-org`: `/register` creates an account and a new org.
- SSO sign-in follows the same rules (just-in-time join only when the SSO connection maps to an org — see ticket **123**).

### 6. Settings visibility

- `meta.json` `settings[]` gains `scope: 'personal' | 'org' | 'deployment'` and, for `org`, the capability it needs (`integrations`, `storage`, …).
  - `personal` (profile, password, My connected drives): every user.
  - `org`: operators (with an **org picker** at the top of Settings to choose which org they are configuring) and `org_admin`s for delegated capabilities only.
  - `deployment` (operators, org list, tenancy summary): operators only.
- In `internal`, operators see org settings directly (no picker; one org).

### 7. Migration for existing deployments

- Without `tenancy` config, existing deployments boot as `saas`-compatible (current behavior: open sign-up, self-serve orgs, switching) with a deprecation warning to choose a preset.
- When a preset is set: users holding `owner`/`admin` → `org_admin`; operator bootstrap as above. For `customer-facing`, non-operators in several orgs keep their active org and are removed from the rest (logged), or migration fails listing them — chosen by flag.
- Demo seed per preset: `admin@example.com` = operator; `viewer@example.com` = member of the demo org.

## Out of scope

- Per-org SSO connections (ticket **123**), per-org plans/feature toggles (ticket **124**), usage limits and billing for platform keys (ticket **125**), per-org white-label (ticket **126**).

## Done when

- [ ] `tenancy` config with three presets, overrides, validation, startup log
- [ ] Operator role with bootstrap, promote/demote, last-operator guard, audited enter/exit
- [ ] Org lifecycle per preset (self-serve, operator-created, single)
- [ ] `orgAdminCan` delegation enforced on all org-settings APIs
- [ ] Invite flow + `invite-only` / `open-creates-org` sign-up
- [ ] Settings `scope` + capability gating; operator org picker
- [ ] Migration path + per-preset demo seed
- [ ] Tests per preset: who can create/switch orgs; org admin blocked from non-delegated settings; customer cannot act outside their org; invite accept joins the right org; operator enter audited
- [ ] Docs: `concepts.md` tenancy rule (deployment / operator / org / org admin + presets); `builtins.md` auth; client-app template sets a preset
- [ ] `bun run ci` green

## Verify

- `saas`: sign up → new org as `org_admin` → configure own email key in Settings → invite a teammate → teammate can join a second org and switch
- `internal`: first user is operator → one org exists → no switcher, no create-org → invited staff join it
- `customer-facing`: operator creates org "Acme" → invites `jane@acme.com` as `org_admin` → Jane sees only Members in org settings; `PUT` to integrations → 403 → operator picks Acme in Settings and configures Acme's email key
