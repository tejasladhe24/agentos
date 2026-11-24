/** Default upstream port — must match `meta.json`. */
export const AUTH_PORT = 6110;

/** Local/dev-only Better Auth secret — never use in production. */
export const DEFAULT_DEV_AUTH_SECRET = 'agentos-dev-auth-secret-min-32-chars!!';

/** Demo credentials for local seed (ticket 15; migrate store in 16). */
export const DEMO_ADMIN = {
  email: 'admin@example.com',
  password: 'password123',
  name: 'Admin',
  role: 'admin',
} as const;

export const DEMO_VIEWER = {
  email: 'viewer@example.com',
  password: 'password123',
  name: 'Viewer',
  role: 'viewer',
} as const;

/** Wildcard permission granted to admin / owner roles. */
export const PERMISSION_ALL = '*';

/** Sample permission granted only to admin/owner (viewer lacks it). */
export const PERMISSION_ADMIN_ONLY = 'auth.admin';

/** Permission required to manage org member roles and role→permission maps. */
export const PERMISSION_ROLES_MANAGE = 'auth.roles.manage';

/** Read org vault secrets (builtin secrets). Admin/owner covered by `*`. */
export const PERMISSION_SECRETS_READ = 'secrets.read';

/** Put/delete org vault secrets (builtin secrets). Admin/owner covered by `*`. */
export const PERMISSION_SECRETS_WRITE = 'secrets.write';

/** List/get org files blobs (builtin files). Admin/owner covered by `*`. */
export const PERMISSION_FILES_READ = 'files.read';

/** Put/delete/move org files blobs (builtin files). Admin/owner covered by `*`. */
export const PERMISSION_FILES_WRITE = 'files.write';

/** Read Activity / audit entries (builtin audit). Admin/owner covered by `*`. */
export const PERMISSION_AUDIT_READ = 'audit.read';

/** Read inbound email + delivery history (Email manager). Admin/owner covered by `*`. */
export const PERMISSION_EMAIL_READ = 'email.read';

/** Compose/send email (notifications) + provision inbound addresses. */
export const PERMISSION_EMAIL_SEND = 'email.send';

/** Configure tenant BYOK integrations (email, SMS, storage, AI). Admin/owner. */
export const PERMISSION_INTEGRATIONS_MANAGE = 'integrations.manage';

/** Platform / org role catalog (TrustDesk-shaped; apps may add product permissions). */
export const PLATFORM_ROLES = [
  'admin',
  'owner',
  'reviewer',
  'sales',
  'viewer',
  'external_viewer',
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Default public-link `purpose` → limited role (ticket 72 + 75).
 * Used when a signed token omits an explicit `role`.
 */
export const PUBLIC_PURPOSE_DEFAULT_ROLE: Record<string, string> = {
  portal: 'external_viewer',
  'trust-center': 'external_viewer',
  'client-link': 'external_viewer',
};
