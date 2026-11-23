import type { Database } from 'bun:sqlite';
import type { Pool } from 'pg';

import {
  PERMISSION_ADMIN_ONLY,
  PERMISSION_ALL,
  PERMISSION_AUDIT_READ,
  PERMISSION_EMAIL_READ,
  PERMISSION_EMAIL_SEND,
  PERMISSION_FILES_READ,
  PERMISSION_FILES_WRITE,
  PERMISSION_ROLES_MANAGE,
  PERMISSION_SECRETS_READ,
  PERMISSION_SECRETS_WRITE,
} from './constants';

export type AuthDialect = 'sqlite' | 'postgres';

export type AuthDb =
  | { dialect: 'sqlite'; client: Database }
  | { dialect: 'postgres'; client: Pool };

export type RolePermissionRow = {
  role: string;
  permission: string;
};

/** Ensure RBAC tables exist on the shared auth connection. */
export async function ensureRbacSchema(db: AuthDb): Promise<void> {
  if (db.dialect === 'sqlite') {
    db.client.exec(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (user_id, role)
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        role TEXT NOT NULL,
        permission TEXT NOT NULL,
        PRIMARY KEY (role, permission)
      );
    `);
    return;
  }

  await db.client.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, role)
    );
  `);
  await db.client.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role, permission)
    );
  `);
}

/** Seed default role → permission rows (idempotent). */
export async function seedRolePermissions(db: AuthDb): Promise<void> {
  const rows: Array<[string, string]> = [
    ['admin', PERMISSION_ALL],
    ['admin', PERMISSION_ADMIN_ONLY],
    ['admin', PERMISSION_ROLES_MANAGE],
    ['admin', PERMISSION_SECRETS_READ],
    ['admin', PERMISSION_SECRETS_WRITE],
    ['admin', PERMISSION_FILES_READ],
    ['admin', PERMISSION_FILES_WRITE],
    ['admin', PERMISSION_AUDIT_READ],
    ['admin', PERMISSION_EMAIL_READ],
    ['admin', PERMISSION_EMAIL_SEND],
    ['owner', PERMISSION_ALL],
    ['owner', PERMISSION_ADMIN_ONLY],
    ['owner', PERMISSION_ROLES_MANAGE],
    ['owner', PERMISSION_SECRETS_READ],
    ['owner', PERMISSION_SECRETS_WRITE],
    ['owner', PERMISSION_FILES_READ],
    ['owner', PERMISSION_FILES_WRITE],
    ['owner', PERMISSION_AUDIT_READ],
    ['owner', PERMISSION_EMAIL_READ],
    ['owner', PERMISSION_EMAIL_SEND],
    ['viewer', 'auth.session.read'],
    ['viewer', PERMISSION_FILES_READ],
    ['viewer', PERMISSION_EMAIL_READ],
    ['reviewer', 'auth.session.read'],
    ['reviewer', PERMISSION_SECRETS_READ],
    ['reviewer', PERMISSION_FILES_READ],
    ['reviewer', PERMISSION_AUDIT_READ],
    ['reviewer', PERMISSION_EMAIL_READ],
    ['reviewer', PERMISSION_EMAIL_SEND],
    ['sales', 'auth.session.read'],
    ['sales', PERMISSION_SECRETS_READ],
    ['sales', PERMISSION_FILES_READ],
    ['sales', PERMISSION_AUDIT_READ],
    ['sales', PERMISSION_EMAIL_READ],
    ['sales', PERMISSION_EMAIL_SEND],
    ['external_viewer', 'auth.session.read'],
  ];

  if (db.dialect === 'sqlite') {
    const insert = db.client.prepare(
      `INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)`,
    );
    for (const [role, permission] of rows) {
      insert.run(role, permission);
    }
    return;
  }

  for (const [role, permission] of rows) {
    await db.client.query(
      `INSERT INTO role_permissions (role, permission) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [role, permission],
    );
  }
}

export async function assignUserRole(
  db: AuthDb,
  userId: string,
  role: string,
): Promise<void> {
  if (db.dialect === 'sqlite') {
    db.client
      .prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)`)
      .run(userId, role);
    return;
  }

  await db.client.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, role],
  );
}

/** Global (platform) roles only — not org membership roles. */
export async function listGlobalRolesForUser(
  db: AuthDb,
  userId: string,
): Promise<string[]> {
  if (db.dialect === 'sqlite') {
    const rows = db.client
      .prepare(`SELECT role FROM user_roles WHERE user_id = ?`)
      .all(userId) as Array<{ role: string }>;
    return rows.map((r) => r.role);
  }

  const result = await db.client.query<{ role: string }>(
    `SELECT role FROM user_roles WHERE user_id = $1`,
    [userId],
  );
  return result.rows.map((r) => r.role);
}

/**
 * Roles for permission checks / session.
 * When `orgId` is set, includes the org membership role plus global roles.
 */
export async function listRolesForUser(
  db: AuthDb,
  userId: string,
  orgId?: string | null,
): Promise<string[]> {
  const global = await listGlobalRolesForUser(db, userId);
  if (!orgId) {
    return global;
  }

  let orgRole: string | null = null;
  if (db.dialect === 'sqlite') {
    const row = db.client
      .prepare(
        `SELECT role FROM org_members WHERE org_id = ? AND user_id = ? LIMIT 1`,
      )
      .get(orgId, userId) as { role: string } | null;
    orgRole = row?.role ?? null;
  } else {
    const result = await db.client.query<{ role: string }>(
      `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [orgId, userId],
    );
    orgRole = result.rows[0]?.role ?? null;
  }

  if (!orgRole) {
    return global;
  }
  return [...new Set([orgRole, ...global])];
}

/** True when any of the user's roles grants `permission` or `*`. */
export async function userHasPermission(
  db: AuthDb,
  userId: string,
  permission: string,
  orgId?: string | null,
): Promise<boolean> {
  const roles = await listRolesForUser(db, userId, orgId);
  if (roles.length === 0) {
    return false;
  }

  if (db.dialect === 'sqlite') {
    const placeholders = roles.map(() => '?').join(', ');
    const row = db.client
      .prepare(
        `SELECT 1 AS ok
         FROM role_permissions
         WHERE role IN (${placeholders})
           AND (permission = ? OR permission = ?)
         LIMIT 1`,
      )
      .get(...roles, permission, PERMISSION_ALL) as { ok: number } | null;
    return row != null;
  }

  const result = await db.client.query(
    `SELECT 1 AS ok
     FROM role_permissions
     WHERE role = ANY($1::text[])
       AND (permission = $2 OR permission = $3)
     LIMIT 1`,
    [roles, permission, PERMISSION_ALL],
  );
  return (result.rowCount ?? 0) > 0;
}

/** List the role → permission catalog (all rows). */
export async function listRolePermissions(
  db: AuthDb,
): Promise<RolePermissionRow[]> {
  if (db.dialect === 'sqlite') {
    return db.client
      .prepare(
        `SELECT role, permission FROM role_permissions ORDER BY role, permission`,
      )
      .all() as RolePermissionRow[];
  }

  const result = await db.client.query<RolePermissionRow>(
    `SELECT role, permission FROM role_permissions ORDER BY role, permission`,
  );
  return result.rows;
}

/** Distinct role names in the catalog. */
export async function listRoles(db: AuthDb): Promise<string[]> {
  const rows = await listRolePermissions(db);
  return [...new Set(rows.map((r) => r.role))].sort();
}

/**
 * Replace all permissions for a role (idempotent full replace).
 * Empty `permissions` deletes the role's grants.
 */
export async function setRolePermissions(
  db: AuthDb,
  role: string,
  permissions: string[],
): Promise<void> {
  const trimmed = role.trim();
  if (!trimmed) {
    throw new Error('role required');
  }
  const unique = [
    ...new Set(permissions.map((p) => p.trim()).filter((p) => p.length > 0)),
  ];

  if (db.dialect === 'sqlite') {
    db.client
      .prepare(`DELETE FROM role_permissions WHERE role = ?`)
      .run(trimmed);
    const insert = db.client.prepare(
      `INSERT INTO role_permissions (role, permission) VALUES (?, ?)`,
    );
    for (const permission of unique) {
      insert.run(trimmed, permission);
    }
    return;
  }

  await db.client.query(`DELETE FROM role_permissions WHERE role = $1`, [
    trimmed,
  ]);
  for (const permission of unique) {
    await db.client.query(
      `INSERT INTO role_permissions (role, permission) VALUES ($1, $2)`,
      [trimmed, permission],
    );
  }
}
