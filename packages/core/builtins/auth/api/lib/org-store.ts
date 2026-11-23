import type { AuthDb } from './rbac-store';

export type OrgMembership = {
  id: string;
  name: string;
  role: string;
};

export type Organization = {
  id: string;
  name: string;
  createdAt: string;
};

/** Default membership role assigned to the creator of a new org. */
export const ORG_ROLE_OWNER = 'owner';

/** Demo org shared by seeded local users. */
export const DEMO_ORG_NAME = 'Demo Organization';

/** Ensure org / membership / active-org tables exist on the auth connection. */
export async function ensureOrgSchema(db: AuthDb): Promise<void> {
  if (db.dialect === 'sqlite') {
    db.client.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS org_members (
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (org_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS user_active_org (
        user_id TEXT NOT NULL PRIMARY KEY,
        org_id TEXT NOT NULL
      );
    `);
    return;
  }

  await db.client.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
  await db.client.query(`
    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );
  `);
  await db.client.query(`
    CREATE TABLE IF NOT EXISTS user_active_org (
      user_id TEXT NOT NULL PRIMARY KEY,
      org_id TEXT NOT NULL
    );
  `);
}

function newOrgId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function createOrganization(
  db: AuthDb,
  input: { name: string; creatorUserId: string; role?: string },
): Promise<Organization> {
  const id = newOrgId();
  const name = input.name.trim();
  const createdAt = nowIso();
  const role = input.role ?? ORG_ROLE_OWNER;

  if (!name) {
    throw new Error('organization name required');
  }

  if (db.dialect === 'sqlite') {
    db.client
      .prepare(
        `INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)`,
      )
      .run(id, name, createdAt);
    db.client
      .prepare(
        `INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)`,
      )
      .run(id, input.creatorUserId, role);
  } else {
    await db.client.query(
      `INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, $3)`,
      [id, name, createdAt],
    );
    await db.client.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)`,
      [id, input.creatorUserId, role],
    );
  }

  await setActiveOrg(db, input.creatorUserId, id);
  return { id, name, createdAt };
}

export async function listOrgsForUser(
  db: AuthDb,
  userId: string,
): Promise<OrgMembership[]> {
  if (db.dialect === 'sqlite') {
    const rows = db.client
      .prepare(
        `SELECT o.id AS id, o.name AS name, m.role AS role
         FROM org_members m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = ?
         ORDER BY o.name COLLATE NOCASE ASC`,
      )
      .all(userId) as Array<{ id: string; name: string; role: string }>;
    return rows;
  }

  const result = await db.client.query<{
    id: string;
    name: string;
    role: string;
  }>(
    `SELECT o.id AS id, o.name AS name, m.role AS role
     FROM org_members m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
     ORDER BY LOWER(o.name) ASC`,
    [userId],
  );
  return result.rows;
}

export async function isOrgMember(
  db: AuthDb,
  userId: string,
  orgId: string,
): Promise<boolean> {
  if (db.dialect === 'sqlite') {
    const row = db.client
      .prepare(
        `SELECT 1 AS ok FROM org_members WHERE org_id = ? AND user_id = ? LIMIT 1`,
      )
      .get(orgId, userId) as { ok: number } | null;
    return row != null;
  }

  const result = await db.client.query(
    `SELECT 1 AS ok FROM org_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setActiveOrg(
  db: AuthDb,
  userId: string,
  orgId: string,
): Promise<void> {
  if (db.dialect === 'sqlite') {
    db.client
      .prepare(
        `INSERT INTO user_active_org (user_id, org_id) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET org_id = excluded.org_id`,
      )
      .run(userId, orgId);
    return;
  }

  await db.client.query(
    `INSERT INTO user_active_org (user_id, org_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET org_id = EXCLUDED.org_id`,
    [userId, orgId],
  );
}

export async function getActiveOrgId(
  db: AuthDb,
  userId: string,
): Promise<string | null> {
  if (db.dialect === 'sqlite') {
    const row = db.client
      .prepare(`SELECT org_id FROM user_active_org WHERE user_id = ? LIMIT 1`)
      .get(userId) as { org_id: string } | null;
    return row?.org_id ?? null;
  }

  const result = await db.client.query<{ org_id: string }>(
    `SELECT org_id FROM user_active_org WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.org_id ?? null;
}

/**
 * Resolve the user's active org: stored preference if still a member,
 * otherwise first membership (and persist), otherwise null.
 */
export async function resolveActiveOrgId(
  db: AuthDb,
  userId: string,
): Promise<string | null> {
  const memberships = await listOrgsForUser(db, userId);
  if (memberships.length === 0) {
    return null;
  }

  const stored = await getActiveOrgId(db, userId);
  if (stored && memberships.some((m) => m.id === stored)) {
    return stored;
  }

  const fallback = memberships[0]!.id;
  await setActiveOrg(db, userId, fallback);
  return fallback;
}

/** Ensure a named demo org exists and the user is a member (owner if new). */
export async function ensureDemoOrgMembership(
  db: AuthDb,
  userId: string,
  orgName = DEMO_ORG_NAME,
): Promise<string> {
  let orgId: string | null = null;

  if (db.dialect === 'sqlite') {
    const row = db.client
      .prepare(`SELECT id FROM organizations WHERE name = ? LIMIT 1`)
      .get(orgName) as { id: string } | null;
    orgId = row?.id ?? null;
  } else {
    const result = await db.client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE name = $1 LIMIT 1`,
      [orgName],
    );
    orgId = result.rows[0]?.id ?? null;
  }

  if (!orgId) {
    const created = await createOrganization(db, {
      name: orgName,
      creatorUserId: userId,
      role: ORG_ROLE_OWNER,
    });
    return created.id;
  }

  if (!(await isOrgMember(db, userId, orgId))) {
    if (db.dialect === 'sqlite') {
      db.client
        .prepare(
          `INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)`,
        )
        .run(orgId, userId, ORG_ROLE_OWNER);
    } else {
      await db.client.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [orgId, userId, ORG_ROLE_OWNER],
      );
    }
  }

  const active = await getActiveOrgId(db, userId);
  if (!active) {
    await setActiveOrg(db, userId, orgId);
  }
  return orgId;
}
