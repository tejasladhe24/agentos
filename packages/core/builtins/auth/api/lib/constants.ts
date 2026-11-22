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

/** Wildcard permission granted to the `admin` role. */
export const PERMISSION_ALL = '*';

/** Sample permission granted only to `admin` (viewer lacks it). */
export const PERMISSION_ADMIN_ONLY = 'auth.admin';
