import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { Database } from 'bun:sqlite';

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
import {
  assignUserRole,
  ensureRbacSchema,
  seedRolePermissions,
} from './rbac-store';

export type AuthSqlite = Database;

type BetterAuthSendResetPassword = NonNullable<
  NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']
>;

export type CreateAuthOptions = {
  /** SQLite path, or `:memory:` for tests. */
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
};

export type AuthContext = {
  auth: Auth;
  db: AuthSqlite;
  permissionCache?: PermissionCacheConfig;
};

/** Default local store: `~/.agentos/store/auth.sqlite` (override with AGENT_OS_EXT_AUTH_DB). */
function defaultDatabasePath(): string {
  return join(homedir(), '.agentos', 'store', 'auth.sqlite');
}

function openDatabase(databasePath: string): AuthSqlite {
  if (databasePath !== ':memory:') {
    mkdirSync(join(databasePath, '..'), { recursive: true });
  }
  return new Database(databasePath);
}

function findUserIdByEmail(db: AuthSqlite, email: string): string | null {
  const row = db
    .prepare(`SELECT id FROM user WHERE email = ? LIMIT 1`)
    .get(email) as { id: string } | null;
  return row?.id ?? null;
}

async function seedDemoUser(
  auth: Auth,
  db: AuthSqlite,
  demo: typeof DEMO_ADMIN | typeof DEMO_VIEWER,
): Promise<void> {
  let userId = findUserIdByEmail(db, demo.email);
  if (!userId) {
    try {
      const created = await auth.api.signUpEmail({
        body: {
          email: demo.email,
          password: demo.password,
          name: demo.name,
        },
      });
      userId = created?.user?.id ?? findUserIdByEmail(db, demo.email);
    } catch {
      userId = findUserIdByEmail(db, demo.email);
    }
  }
  if (userId) {
    assignUserRole(db, userId, demo.role);
  }
}

/**
 * Build Better Auth + local RBAC store (temp SQLite until ticket 16 / db-store).
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
  const db = openDatabase(databasePath);
  const baseURL = options.baseURL ?? `http://127.0.0.1:${AUTH_PORT}`;
  const appOrigin =
    options.appOrigin ??
    env.AGENT_OS_GLOBAL_APP_ORIGIN ??
    'http://localhost:5173';
  const useHttps = usesHttpsOrigin(appOrigin, baseURL);
  const shouldSeed = options.seedDemoUsers ?? !production;

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

  const betterAuthOptions: BetterAuthOptions = {
    database: db,
    baseURL,
    secret: resolvedSecret,
    emailAndPassword: {
      enabled: true,
      sendResetPassword,
    },
    trustedOrigins: buildTrustedOrigins(baseURL, appOrigin, production),
    advanced: {
      useSecureCookies: useHttps,
      defaultCookieAttributes: {
        sameSite: 'lax' as const,
        secure: useHttps,
        httpOnly: true,
        path: '/',
      },
    },
  };

  const { runMigrations } = await getMigrations(betterAuthOptions);
  await runMigrations();

  ensureRbacSchema(db);
  seedRolePermissions(db);

  const auth = betterAuth(betterAuthOptions) as Auth;

  if (shouldSeed) {
    await seedDemoUser(auth, db, DEMO_ADMIN);
    await seedDemoUser(auth, db, DEMO_VIEWER);
  }

  return { auth, db, permissionCache: options.permissionCache };
}
