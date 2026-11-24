import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sso, type SSOOptions } from '@better-auth/sso';
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { Database } from 'bun:sqlite';
import { Pool } from 'pg';

import {
  AUTH_PORT,
  DEFAULT_DEV_AUTH_SECRET,
  DEMO_ADMIN,
  DEMO_VIEWER,
} from './constants';
import type { PermissionCacheConfig } from './permission-cache';
import {
  assertProductionAuthSecret,
  buildTrustedOrigins,
  isAuthProduction,
  usesHttpsOrigin,
} from './production';
import { ensureDemoOrgMembership, ensureOrgSchema } from './org-store';
import {
  assignUserRole,
  ensureRbacSchema,
  seedRolePermissions,
  type AuthDb,
  type AuthDialect,
} from './rbac-store';
import {
  buildSsoPluginOptions,
  readSsoEnv,
  ssoTrustedOrigins,
  type AuthSsoEnv,
} from './sso-config';

/** @deprecated Prefer AuthDb; kept for callers that typed the old SQLite handle. */
export type AuthSqlite = Database;

type BetterAuthSendResetPassword = NonNullable<
  NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']
>;

export type CreateAuthOptions = {
  /**
   * SQLite path, `:memory:` for tests, or a `postgres://` / `postgresql://` URL.
   * Override for `AGENT_OS_EXT_AUTH_DB`.
   */
  databasePath?: string;
  baseURL?: string;
  secret?: string;
  /**
   * When set, forces demo seed on/off.
   * When unset, seeds outside production only.
   */
  seedDemoUsers?: boolean;
  /** Optional soft-fail permission cache via cache-store. */
  permissionCache?: PermissionCacheConfig;
  /**
   * Origin of the consumer Shell (for password-reset links).
   * @default http://localhost:5173
   */
  appOrigin?: string;
  /** Override password-reset email sender (tests). Default logs the app URL. */
  sendResetPassword?: BetterAuthSendResetPassword;
  /** Env bag for production / origin detection (defaults to `Bun.env`). */
  env?: Record<string, string | undefined>;
  /** Override SSO env (tests). Defaults to reading from `env`. */
  ssoEnv?: AuthSsoEnv;
  /** Extra Better Auth SSO plugin options (tests / advanced). */
  ssoOptions?: Partial<SSOOptions>;
};

export type AuthContext = {
  auth: Auth;
  dialect: AuthDialect;
  db: AuthDb;
  close: () => Promise<void>;
  permissionCache?: PermissionCacheConfig;
  /** True when a defaultSSO OIDC provider was configured from env/options. */
  ssoConfigured: boolean;
  /**
   * Offboarding hook after `POST /orgs/members/remove` (tests override).
   * Default purges the user's user-owned secrets in that org (ticket 104).
   */
  onMemberRemoved?: (input: { orgId: string; userId: string }) => Promise<void>;
};

/** True when the value is a Postgres connection URL. */
export function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

/** Default local store: `~/.agentos/store/auth.sqlite` (override with AGENT_OS_EXT_AUTH_DB). */
function defaultDatabasePath(): string {
  return join(homedir(), '.agentos', 'store', 'auth.sqlite');
}

function openSqlite(databasePath: string): Database {
  if (databasePath !== ':memory:') {
    mkdirSync(join(databasePath, '..'), { recursive: true });
  }
  return new Database(databasePath);
}

async function findUserIdByEmail(
  db: AuthDb,
  email: string,
): Promise<string | null> {
  if (db.dialect === 'sqlite') {
    const row = db.client
      .prepare(`SELECT id FROM user WHERE email = ? LIMIT 1`)
      .get(email) as { id: string } | null;
    return row?.id ?? null;
  }

  const result = await db.client.query<{ id: string }>(
    `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
    [email],
  );
  return result.rows[0]?.id ?? null;
}

async function seedDemoUser(
  auth: Auth,
  db: AuthDb,
  demo: typeof DEMO_ADMIN | typeof DEMO_VIEWER,
): Promise<void> {
  let userId = await findUserIdByEmail(db, demo.email);
  if (!userId) {
    try {
      const created = await auth.api.signUpEmail({
        body: {
          email: demo.email,
          password: demo.password,
          name: demo.name,
        },
      });
      userId = created?.user?.id ?? (await findUserIdByEmail(db, demo.email));
    } catch {
      userId = await findUserIdByEmail(db, demo.email);
    }
  }
  if (userId) {
    await assignUserRole(db, userId, demo.role);
    // Admin seeds as org owner; viewer joins as viewer (not owner).
    const orgRole = demo.role === 'admin' ? 'owner' : demo.role;
    await ensureDemoOrgMembership(db, userId, undefined, orgRole);
  }
}

/**
 * Build Better Auth + local RBAC store (SQLite default; Postgres via URL).
 * Includes Better Auth SSO plugin (OIDC/SAML); email/password remains enabled.
 */
export async function createAuth(
  options: CreateAuthOptions = {},
): Promise<AuthContext> {
  const env = options.env ?? Bun.env;
  const production = isAuthProduction(env);
  const resolvedSecret =
    options.secret ?? (production ? undefined : DEFAULT_DEV_AUTH_SECRET);
  assertProductionAuthSecret(resolvedSecret, env);
  if (!resolvedSecret) {
    throw new Error('AGENT_OS_EXT_AUTH_SECRET is required');
  }

  const databasePath = options.databasePath ?? defaultDatabasePath();
  const postgres = isPostgresUrl(databasePath);

  let database: BetterAuthOptions['database'];
  let db: AuthDb;
  let dialect: AuthDialect;
  let close: () => Promise<void>;

  if (postgres) {
    const pool = new Pool({ connectionString: databasePath, max: 4 });
    database = pool;
    db = { dialect: 'postgres', client: pool };
    dialect = 'postgres';
    close = async () => {
      await pool.end();
    };
  } else {
    const sqlite = openSqlite(databasePath);
    database = sqlite;
    db = { dialect: 'sqlite', client: sqlite };
    dialect = 'sqlite';
    close = async () => {
      sqlite.close();
    };
  }

  const baseURL = options.baseURL ?? `http://127.0.0.1:${AUTH_PORT}`;
  const appOrigin =
    options.appOrigin ??
    env.AGENT_OS_GLOBAL_APP_ORIGIN ??
    'http://localhost:5173';
  const useHttps = usesHttpsOrigin(appOrigin, baseURL);
  const shouldSeed = options.seedDemoUsers ?? !production;

  const ssoEnv = options.ssoEnv ?? readSsoEnv(env);
  const ssoPluginOptions = buildSsoPluginOptions(ssoEnv, {
    provisionUser: async ({ user }) => {
      await assignUserRole(db, user.id, DEMO_VIEWER.role);
      await ensureDemoOrgMembership(db, user.id, undefined, DEMO_VIEWER.role);
    },
    ...options.ssoOptions,
  });
  const ssoConfigured = (ssoPluginOptions.defaultSSO?.length ?? 0) > 0;

  const sendResetPassword: BetterAuthSendResetPassword = async (
    data,
    request,
  ) => {
    if (options.sendResetPassword) {
      await options.sendResetPassword(data, request);
      return;
    }
    const resetUrl = `${appOrigin}/reset-password?token=${encodeURIComponent(data.token)}`;
    console.info(`[auth] Password reset for ${data.user.email}: ${resetUrl}`);
  };

  const trustedOrigins = [
    ...buildTrustedOrigins(baseURL, appOrigin, production),
    ...ssoTrustedOrigins(ssoEnv),
  ];

  const betterAuthOptions: BetterAuthOptions = {
    database,
    baseURL,
    /**
     * Gateway proxies `/api/ext/auth/*` → Bun paths at `/`. Use `/` so SSO
     * callbacks (`/sso/callback/:id`) match without an `/api/auth` prefix.
     */
    basePath: '/',
    secret: resolvedSecret,
    emailAndPassword: {
      enabled: true,
      sendResetPassword,
    },
    trustedOrigins: [...new Set(trustedOrigins)],
    advanced: {
      useSecureCookies: useHttps,
      defaultCookieAttributes: {
        sameSite: 'lax' as const,
        secure: useHttps,
        httpOnly: true,
        path: '/',
      },
    },
    plugins: [sso(ssoPluginOptions)],
  };

  const { runMigrations } = await getMigrations(betterAuthOptions);
  await runMigrations();

  await ensureRbacSchema(db);
  await seedRolePermissions(db);
  await ensureOrgSchema(db);

  const auth = betterAuth(betterAuthOptions) as Auth;

  if (shouldSeed) {
    await seedDemoUser(auth, db, DEMO_ADMIN);
    await seedDemoUser(auth, db, DEMO_VIEWER);
  }

  return {
    auth,
    dialect,
    db,
    close,
    permissionCache: options.permissionCache,
    ssoConfigured,
  };
}
