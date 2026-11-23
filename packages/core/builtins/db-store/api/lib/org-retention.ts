import { ORG_RETENTION_COLLECTION, PLATFORM_ORG_ID } from './constants';
import { CollectionError } from './collection-error';
import {
  deleteDocuments,
  insertDocument,
  queryCollection,
  updateDocument,
  type DocumentRow,
} from './collections';
import { setRequestOrgId, type DbStoreContext } from './create-db';

export type OrgRetentionConfig = {
  /** Applied on prune for opted-in collections that lack a collection TTL. */
  defaultTtlSeconds?: number;
  /** When true, block subject deletion and TTL/maxCount prune for this org. */
  legalHold: boolean;
  holdReason?: string;
  /** Collections that honor {@link defaultTtlSeconds} when no collection policy TTL is set. */
  optedInCollections?: string[];
};

export type OrgRetentionRecord = OrgRetentionConfig & {
  orgId: string;
};

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Parse / validate org retention body (set path). */
export function parseOrgRetentionConfig(
  body: Record<string, unknown>,
): OrgRetentionConfig {
  const legalHold = body.legalHold === true;
  const config: OrgRetentionConfig = { legalHold };

  if ('defaultTtlSeconds' in body && body.defaultTtlSeconds !== undefined) {
    if (!isPositiveInt(body.defaultTtlSeconds)) {
      throw new CollectionError('defaultTtlSeconds must be a positive integer');
    }
    config.defaultTtlSeconds = body.defaultTtlSeconds;
  }

  if ('holdReason' in body && body.holdReason !== undefined) {
    if (typeof body.holdReason !== 'string') {
      throw new CollectionError('holdReason must be a string');
    }
    const reason = body.holdReason.trim();
    if (reason) config.holdReason = reason;
  }

  if ('optedInCollections' in body && body.optedInCollections !== undefined) {
    if (!Array.isArray(body.optedInCollections)) {
      throw new CollectionError('optedInCollections must be an array of names');
    }
    const names: string[] = [];
    for (const raw of body.optedInCollections) {
      if (typeof raw !== 'string' || !FIELD_NAME.test(raw)) {
        throw new CollectionError(
          'optedInCollections entries must be collection name identifiers',
        );
      }
      names.push(raw);
    }
    config.optedInCollections = names;
  }

  if (
    config.defaultTtlSeconds === undefined &&
    !config.legalHold &&
    (config.optedInCollections === undefined ||
      config.optedInCollections.length === 0) &&
    config.holdReason === undefined
  ) {
    throw new CollectionError(
      'org retention requires legalHold, defaultTtlSeconds, and/or optedInCollections',
    );
  }

  return config;
}

function configFromRow(row: DocumentRow): OrgRetentionRecord {
  const data = row.data;
  const orgId =
    typeof data.targetOrgId === 'string'
      ? data.targetOrgId
      : typeof data.orgId === 'string' && data.orgId !== PLATFORM_ORG_ID
        ? data.orgId
        : row.id;
  const record: OrgRetentionRecord = {
    orgId,
    legalHold: data.legalHold === true,
  };
  if (isPositiveInt(data.defaultTtlSeconds)) {
    record.defaultTtlSeconds = data.defaultTtlSeconds;
  }
  if (typeof data.holdReason === 'string' && data.holdReason.trim()) {
    record.holdReason = data.holdReason.trim();
  }
  if (Array.isArray(data.optedInCollections)) {
    record.optedInCollections = data.optedInCollections.filter(
      (n): n is string => typeof n === 'string' && FIELD_NAME.test(n),
    );
  }
  return record;
}

/** Load org-level retention config from the platform collection. */
export async function getOrgRetention(
  ctx: DbStoreContext,
  orgId: string,
): Promise<OrgRetentionRecord | null> {
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  const { items } = await queryCollection(
    ctx,
    ORG_RETENTION_COLLECTION,
    {},
    PLATFORM_ORG_ID,
  );
  const match = items.find((row) => row.id === orgId);
  if (!match) return null;
  return configFromRow(match);
}

export async function setOrgRetention(
  ctx: DbStoreContext,
  orgId: string,
  config: OrgRetentionConfig,
): Promise<OrgRetentionRecord> {
  const data: Record<string, unknown> = {
    targetOrgId: orgId,
    legalHold: config.legalHold,
  };
  if (config.defaultTtlSeconds !== undefined) {
    data.defaultTtlSeconds = config.defaultTtlSeconds;
  }
  if (config.holdReason !== undefined) {
    data.holdReason = config.holdReason;
  }
  if (config.optedInCollections !== undefined) {
    data.optedInCollections = config.optedInCollections;
  }

  const existing = await getOrgRetention(ctx, orgId);
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  if (existing) {
    await updateDocument(
      ctx,
      ORG_RETENTION_COLLECTION,
      { id: orgId, data, merge: false },
      PLATFORM_ORG_ID,
    );
  } else {
    await insertDocument(
      ctx,
      ORG_RETENTION_COLLECTION,
      { id: orgId, data },
      PLATFORM_ORG_ID,
    );
  }
  return { orgId, ...config };
}

export async function clearOrgRetention(
  ctx: DbStoreContext,
  orgId: string,
): Promise<{ cleared: boolean }> {
  const existing = await getOrgRetention(ctx, orgId);
  if (!existing) return { cleared: false };
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  await deleteDocuments(
    ctx,
    ORG_RETENTION_COLLECTION,
    { id: orgId },
    PLATFORM_ORG_ID,
  );
  return { cleared: true };
}

export async function listOrgRetentions(
  ctx: DbStoreContext,
): Promise<OrgRetentionRecord[]> {
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  const { items } = await queryCollection(
    ctx,
    ORG_RETENTION_COLLECTION,
    {},
    PLATFORM_ORG_ID,
  );
  return items.map(configFromRow).filter((r) => r.orgId);
}

/** Throw 423 when the org is under legal hold. */
export async function assertNotOnLegalHold(
  ctx: DbStoreContext,
  orgId: string,
): Promise<void> {
  const config = await getOrgRetention(ctx, orgId);
  if (config?.legalHold) {
    const reason = config.holdReason ? `: ${config.holdReason}` : '';
    throw new CollectionError(`legal hold active${reason}`, 423);
  }
}

/** Whether this collection should receive org default TTL on prune. */
export function isOptedInForDefaultTtl(
  config: OrgRetentionRecord | null | undefined,
  collection: string,
): boolean {
  if (!config?.defaultTtlSeconds) return false;
  const list = config.optedInCollections;
  if (!list || list.length === 0) return false;
  return list.includes(collection);
}
