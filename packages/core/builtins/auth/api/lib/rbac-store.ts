import type { Database } from 'bun:sqlite';
import type { Pool } from 'pg';

import { PERMISSION_ADMIN_ONLY, PERMISSION_ALL } from './constants';

export type AuthDialect = 'sqlite' | 'postgres';

export type AuthDb =
  | { dialect: 'sqlite'; client: Database }
  | { dialect: 'postgres'; client: Pool };

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
    ['viewer', 'auth.session.read'],
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

export async function listRolesForUser(
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

/** True when any of the user's roles grants `permission` or `*`. */
export async function userHasPermission(
  db: AuthDb,
  userId: string,
  permission: string,
): Promise<boolean> {
  if (db.dialect === 'sqlite') {
    const row = db.client
      .prepare(
        `SELECT 1 AS ok
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role = ur.role
         WHERE ur.user_id = ?
           AND (rp.permission = ? OR rp.permission = ?)
         LIMIT 1`,
      )
      .get(userId, permission, PERMISSION_ALL) as { ok: number } | null;
    return row != null;
  }

  const result = await db.client.query(
    `SELECT 1 AS ok
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role = ur.role
     WHERE ur.user_id = $1
       AND (rp.permission = $2 OR rp.permission = $3)
     LIMIT 1`,
    [userId, permission, PERMISSION_ALL],
  );
  return (result.rowCount ?? 0) > 0;
}
