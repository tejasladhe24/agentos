import { and, eq, inArray } from 'drizzle-orm';

import type { DbStoreContext } from './create-db';
import { pgDocuments, sqliteDocuments } from './schema';

export type DocumentRow = {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type QueryInput = {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
};

export type InsertInput = {
  id?: string;
  data: Record<string, unknown>;
};

export type UpdateInput = {
  id: string;
  data: Record<string, unknown>;
  merge?: boolean;
};

export type DeleteInput = {
  id?: string;
  ids?: string[];
};

export class CollectionError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'CollectionError';
  }
}

function assertDataObject(
  data: unknown,
  label = 'data',
): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CollectionError(`${label} must be a JSON object`);
  }
  return data as Record<string, unknown>;
}

function assertWhere(where: unknown): Record<string, unknown> | undefined {
  if (where === undefined || where === null) return undefined;
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new CollectionError(
      'where must be a flat JSON object of equality filters',
    );
  }
  const obj = where as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) {
      throw new CollectionError(`unsupported where operator: ${key}`);
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      throw new CollectionError(
        `where.${key}: nested objects / operators are not supported in v1 (flat equality only)`,
      );
    }
  }
  return obj;
}

function matchesWhere(
  data: Record<string, unknown>,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (data[key] !== expected) return false;
  }
  return true;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function parseSqliteData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return assertDataObject(parsed, 'stored data');
  } catch {
    throw new CollectionError('corrupt document data', 500);
  }
}

/** Stamp authoritative orgId into document data; reject conflicting client values. */
function stampOrgData(
  data: Record<string, unknown>,
  orgId: string,
): Record<string, unknown> {
  if (
    'orgId' in data &&
    data.orgId !== undefined &&
    data.orgId !== null &&
    data.orgId !== orgId
  ) {
    throw new CollectionError('orgId mismatch', 403);
  }
  return { ...data, orgId };
}

function stripOrgIdPatch(
  patch: Record<string, unknown>,
  orgId: string,
): Record<string, unknown> {
  if (
    'orgId' in patch &&
    patch.orgId !== undefined &&
    patch.orgId !== null &&
    patch.orgId !== orgId
  ) {
    throw new CollectionError('orgId mismatch', 403);
  }
  const { orgId: _ignored, ...rest } = patch;
  return rest;
}

/**
 * Collection CRUD over the shared `documents` table (logical partitions by name).
 * All reads/writes are scoped to `orgId` (SQL column is authoritative).
 */
export async function queryCollection(
  ctx: DbStoreContext,
  collection: string,
  input: QueryInput = {},
  orgId: string,
): Promise<{ items: DocumentRow[] }> {
  const where = assertWhere(input.where);
  const limit =
    typeof input.limit === 'number' && input.limit >= 0
      ? Math.floor(input.limit)
      : undefined;
  const offset =
    typeof input.offset === 'number' && input.offset >= 0
      ? Math.floor(input.offset)
      : 0;

  let items: DocumentRow[];

  if (ctx.dialect === 'sqlite') {
    const rows = await ctx.db
      .select()
      .from(sqliteDocuments)
      .where(
        and(
          eq(sqliteDocuments.collection, collection),
          eq(sqliteDocuments.orgId, orgId),
        ),
      );
    items = rows.map((row) => ({
      id: row.id,
      data: parseSqliteData(row.data),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  } else {
    const rows = await ctx.db
      .select()
      .from(pgDocuments)
      .where(
        and(
          eq(pgDocuments.collection, collection),
          eq(pgDocuments.orgId, orgId),
        ),
      );
    items = rows.map((row) => ({
      id: row.id,
      data: row.data,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  items = items.filter((item) => matchesWhere(item.data, where));
  if (offset > 0) items = items.slice(offset);
  if (limit !== undefined) items = items.slice(0, limit);
  return { items };
}

export async function insertDocument(
  ctx: DbStoreContext,
  collection: string,
  input: InsertInput,
  orgId: string,
): Promise<DocumentRow> {
  const data = stampOrgData(assertDataObject(input.data), orgId);
  const id =
    typeof input.id === 'string' && input.id.length > 0 ? input.id : newId();
  const ts = nowIso();

  if (ctx.dialect === 'sqlite') {
    try {
      await ctx.db.insert(sqliteDocuments).values({
        collection,
        orgId,
        id,
        data: JSON.stringify(data),
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') || message.includes('unique')) {
        throw new CollectionError(`document already exists: ${id}`, 409);
      }
      throw error;
    }
  } else {
    try {
      await ctx.db.insert(pgDocuments).values({
        collection,
        orgId,
        id,
        data,
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new CollectionError(`document already exists: ${id}`, 409);
      }
      throw error;
    }
  }

  return { id, data, createdAt: ts, updatedAt: ts };
}

export async function updateDocument(
  ctx: DbStoreContext,
  collection: string,
  input: UpdateInput,
  orgId: string,
): Promise<DocumentRow> {
  if (typeof input.id !== 'string' || !input.id) {
    throw new CollectionError('id is required');
  }
  const patch = stripOrgIdPatch(assertDataObject(input.data), orgId);
  const merge = input.merge === true;
  const ts = nowIso();

  if (ctx.dialect === 'sqlite') {
    const existing = await ctx.db
      .select()
      .from(sqliteDocuments)
      .where(
        and(
          eq(sqliteDocuments.collection, collection),
          eq(sqliteDocuments.orgId, orgId),
          eq(sqliteDocuments.id, input.id),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new CollectionError(`document not found: ${input.id}`, 404);
    }
    const prev = parseSqliteData(existing[0]!.data);
    const data = stampOrgData(merge ? { ...prev, ...patch } : patch, orgId);
    await ctx.db
      .update(sqliteDocuments)
      .set({ data: JSON.stringify(data), updatedAt: ts })
      .where(
        and(
          eq(sqliteDocuments.collection, collection),
          eq(sqliteDocuments.orgId, orgId),
          eq(sqliteDocuments.id, input.id),
        ),
      );
    return {
      id: input.id,
      data,
      createdAt: existing[0]!.createdAt,
      updatedAt: ts,
    };
  }

  const existing = await ctx.db
    .select()
    .from(pgDocuments)
    .where(
      and(
        eq(pgDocuments.collection, collection),
        eq(pgDocuments.orgId, orgId),
        eq(pgDocuments.id, input.id),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    throw new CollectionError(`document not found: ${input.id}`, 404);
  }
  const prev = existing[0]!.data;
  const data = stampOrgData(merge ? { ...prev, ...patch } : patch, orgId);
  await ctx.db
    .update(pgDocuments)
    .set({ data, updatedAt: ts })
    .where(
      and(
        eq(pgDocuments.collection, collection),
        eq(pgDocuments.orgId, orgId),
        eq(pgDocuments.id, input.id),
      ),
    );
  return {
    id: input.id,
    data,
    createdAt: existing[0]!.createdAt,
    updatedAt: ts,
  };
}

export async function deleteDocuments(
  ctx: DbStoreContext,
  collection: string,
  input: DeleteInput,
  orgId: string,
): Promise<{ deleted: number }> {
  const ids =
    Array.isArray(input.ids) && input.ids.length > 0
      ? input.ids.filter((id) => typeof id === 'string' && id.length > 0)
      : typeof input.id === 'string' && input.id
        ? [input.id]
        : [];

  if (ids.length === 0) {
    throw new CollectionError('id or ids required');
  }

  if (ctx.dialect === 'sqlite') {
    const removed = await ctx.db
      .delete(sqliteDocuments)
      .where(
        and(
          eq(sqliteDocuments.collection, collection),
          eq(sqliteDocuments.orgId, orgId),
          inArray(sqliteDocuments.id, ids),
        ),
      )
      .returning({ id: sqliteDocuments.id });
    return { deleted: removed.length };
  }

  const removed = await ctx.db
    .delete(pgDocuments)
    .where(
      and(
        eq(pgDocuments.collection, collection),
        eq(pgDocuments.orgId, orgId),
        inArray(pgDocuments.id, ids),
      ),
    )
    .returning({ id: pgDocuments.id });
  return { deleted: removed.length };
}
