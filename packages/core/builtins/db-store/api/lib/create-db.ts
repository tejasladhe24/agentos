import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import { UNSCOPED_ORG_ID } from './constants';
import { pgDocuments, sqliteDocuments } from './schema';

export type Dialect = 'sqlite' | 'postgres';

export type CreateDbOptions = {
  /** Override AGENT_OS_EXT_DB_STORE_DATABASE_URL (postgres://… or file path). */
  databaseUrl?: string;
  /** SQLite path when not using Postgres; `:memory:` for tests. */
  databasePath?: string;
};

export type SqliteDb = ReturnType<typeof drizzleSqlite>;
export type PostgresDb = ReturnType<typeof drizzlePostgres>;

export type DbStoreContext =
  | {
      dialect: 'sqlite';
      db: SqliteDb;
      client: Database;
      close: () => void;
    }
  | {
      dialect: 'postgres';
      db: PostgresDb;
      client: ReturnType<typeof postgres>;
      close: () => Promise<void>;
    };

/** Default local store: `~/.agentos/store/db-store.sqlite` (override with AGENT_OS_EXT_DB_STORE_PATH). */
function defaultSqlitePath(): string {
  return join(homedir(), '.agentos', 'store', 'db-store.sqlite');
}

function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

async function ensureSqliteSchema(
  db: SqliteDb,
  client: Database,
): Promise<void> {
  const cols = client.prepare(`PRAGMA table_info(documents)`).all() as Array<{
    name: string;
  }>;

  if (cols.length === 0) {
    db.run(sql`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        org_id TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, org_id, id)
      )
    `);
    return;
  }

  const hasOrgId = cols.some((c) => c.name === 'org_id');
  if (hasOrgId) {
    return;
  }

  // Legacy PK (collection, id) → recreate with org_id + backfill.
  db.run(sql`
    CREATE TABLE documents_tenancy_mig (
      collection TEXT NOT NULL,
      org_id TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, org_id, id)
    )
  `);
  client
    .prepare(
      `INSERT INTO documents_tenancy_mig (collection, org_id, id, data, created_at, updated_at)
       SELECT collection, ?, id, data, created_at, updated_at FROM documents`,
    )
    .run(UNSCOPED_ORG_ID);
  db.run(sql`DROP TABLE documents`);
  db.run(sql`ALTER TABLE documents_tenancy_mig RENAME TO documents`);
}

async function ensurePostgresSchema(db: PostgresDb): Promise<void> {
  // Fresh installs: org-scoped PK from day one.
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL,
      org_id TEXT NOT NULL DEFAULT '${UNSCOPED_ORG_ID}',
      id TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (collection, org_id, id)
    )
  `),
  );

  // Migrate legacy tables that lack org_id.
  await db.execute(
    sql.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'id'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = 'org_id'
      ) THEN
        ALTER TABLE documents ADD COLUMN org_id TEXT;
        UPDATE documents SET org_id = '${UNSCOPED_ORG_ID}' WHERE org_id IS NULL;
        ALTER TABLE documents ALTER COLUMN org_id SET NOT NULL;
        ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_pkey;
        ALTER TABLE documents ADD PRIMARY KEY (collection, org_id, id);
      END IF;
    END $$;
  `),
  );

  // Defense-in-depth RLS (app still filters in Drizzle). See builtins docs.
  await db.execute(sql`ALTER TABLE documents ENABLE ROW LEVEL SECURITY`);
  await db.execute(
    sql`DROP POLICY IF EXISTS documents_org_isolation ON documents`,
  );
  await db.execute(sql`
    CREATE POLICY documents_org_isolation ON documents
      USING (org_id = current_setting('app.current_org_id', true))
      WITH CHECK (org_id = current_setting('app.current_org_id', true))
  `);

  // Optional JSON indexes for common portfolio path filters (ticket 76).
  // Query still evaluates operators in-process; these help table scans / EXPLAIN
  // when apps add SQL-side predicates later. Safe to IF NOT EXISTS on every boot.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS documents_data_gin
    ON documents USING GIN (data jsonb_path_ops)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS documents_expiry_at_expr
    ON documents (collection, org_id, ((data->>'expiryAt')))
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS documents_created_at_meta
    ON documents (collection, org_id, created_at DESC)
  `);
}

/**
 * Set Postgres session GUC used by RLS for the remainder of the request.
 * No-op on SQLite (app-layer `WHERE org_id = ?` is the sole filter).
 */
export async function setRequestOrgId(
  ctx: DbStoreContext,
  orgId: string,
): Promise<void> {
  if (ctx.dialect !== 'postgres') return;
  await ctx.db.execute(
    sql`SELECT set_config('app.current_org_id', ${orgId}, true)`,
  );
}

/**
 * Open Drizzle-backed store. Sole process that may hold SQL drivers.
 * Auth and customer APIs must use the HTTP client (ticket 22), not open drivers here.
 */
export async function createDb(
  options: CreateDbOptions = {},
): Promise<DbStoreContext> {
  const databaseUrl = options.databaseUrl ?? undefined;

  if (databaseUrl && isPostgresUrl(databaseUrl)) {
    const client = postgres(databaseUrl, { max: 4 });
    const db = drizzlePostgres(client, { schema: { documents: pgDocuments } });
    await ensurePostgresSchema(db);
    return {
      dialect: 'postgres',
      db,
      client,
      close: async () => {
        await client.end({ timeout: 5 });
      },
    };
  }

  const databasePath =
    options.databasePath ??
    (databaseUrl && !isPostgresUrl(databaseUrl)
      ? databaseUrl.replace(/^file:/, '')
      : undefined) ??
    defaultSqlitePath();

  if (databasePath !== ':memory:') {
    mkdirSync(join(databasePath, '..'), { recursive: true });
  }

  const client = new Database(databasePath);
  const db = drizzleSqlite(client, { schema: { documents: sqliteDocuments } });
  await ensureSqliteSchema(db, client);

  return {
    dialect: 'sqlite',
    db,
    client,
    close: () => {
      client.close();
    },
  };
}
