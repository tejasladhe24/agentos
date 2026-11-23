import {
  ORG_RETENTION_COLLECTION,
  PLATFORM_ORG_ID,
  RETENTION_POLICIES_COLLECTION,
  retentionPolicyDocId,
} from './constants';
import { CollectionError } from './collection-error';
import {
  deleteDocuments,
  insertDocument,
  queryCollection,
  updateDocument,
  type DocumentRow,
} from './collections';
import { setRequestOrgId, type DbStoreContext } from './create-db';
import {
  assertNotOnLegalHold,
  getOrgRetention,
  isOptedInForDefaultTtl,
  listOrgRetentions,
  type OrgRetentionRecord,
} from './org-retention';
import { applySort } from './sort';

export type RetentionPolicy = {
  /** Delete rows whose `createdAt` is older than now − ttlSeconds. */
  ttlSeconds?: number;
  /** Keep only the newest N docs in the collection+org (after TTL prune). */
  maxCount?: number;
  /** When set with maxCount, apply the cap per distinct value of this data field. */
  maxCountGroupBy?: string;
};

export type RetentionPolicyRecord = RetentionPolicy & {
  orgId: string;
  collection: string;
};

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Parse / validate a retention policy body (set path). */
export function parseRetentionPolicy(
  body: Record<string, unknown>,
): RetentionPolicy {
  const policy: RetentionPolicy = {};

  if ('ttlSeconds' in body && body.ttlSeconds !== undefined) {
    if (!isPositiveInt(body.ttlSeconds)) {
      throw new CollectionError('ttlSeconds must be a positive integer');
    }
    policy.ttlSeconds = body.ttlSeconds;
  }

  if ('maxCount' in body && body.maxCount !== undefined) {
    if (!isPositiveInt(body.maxCount)) {
      throw new CollectionError('maxCount must be a positive integer');
    }
    policy.maxCount = body.maxCount;
  }

  if ('maxCountGroupBy' in body && body.maxCountGroupBy !== undefined) {
    if (
      typeof body.maxCountGroupBy !== 'string' ||
      !FIELD_NAME.test(body.maxCountGroupBy)
    ) {
      throw new CollectionError(
        'maxCountGroupBy must be a top-level field identifier',
      );
    }
    policy.maxCountGroupBy = body.maxCountGroupBy;
  }

  if (
    policy.ttlSeconds === undefined &&
    policy.maxCount === undefined &&
    policy.maxCountGroupBy === undefined
  ) {
    throw new CollectionError(
      'retention policy requires ttlSeconds and/or maxCount',
    );
  }

  if (policy.maxCountGroupBy !== undefined && policy.maxCount === undefined) {
    throw new CollectionError('maxCountGroupBy requires maxCount');
  }

  return policy;
}

/** Load policy for org+collection from the platform policies collection. */
export async function getRetentionPolicy(
  ctx: DbStoreContext,
  collection: string,
  orgId: string,
): Promise<RetentionPolicyRecord | null> {
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  const id = retentionPolicyDocId(orgId, collection);
  const { items } = await queryCollection(
    ctx,
    RETENTION_POLICIES_COLLECTION,
    {},
    PLATFORM_ORG_ID,
  );
  const match = items.find((row) => row.id === id);
  if (!match) return null;
  return policyFromRow(match);
}

function policyFromRow(row: DocumentRow): RetentionPolicyRecord {
  const data = row.data;
  // Platform stamp overwrites data.orgId → store tenant under targetOrgId.
  const orgId =
    typeof data.targetOrgId === 'string'
      ? data.targetOrgId
      : typeof data.orgId === 'string' && data.orgId !== PLATFORM_ORG_ID
        ? data.orgId
        : '';
  const collection =
    typeof data.targetCollection === 'string'
      ? data.targetCollection
      : typeof data.collection === 'string'
        ? data.collection
        : '';
  const policy: RetentionPolicyRecord = { orgId, collection };
  if (isPositiveInt(data.ttlSeconds)) policy.ttlSeconds = data.ttlSeconds;
  if (isPositiveInt(data.maxCount)) policy.maxCount = data.maxCount;
  if (
    typeof data.maxCountGroupBy === 'string' &&
    FIELD_NAME.test(data.maxCountGroupBy)
  ) {
    policy.maxCountGroupBy = data.maxCountGroupBy;
  }
  return policy;
}

export async function setRetentionPolicy(
  ctx: DbStoreContext,
  collection: string,
  orgId: string,
  policy: RetentionPolicy,
): Promise<RetentionPolicyRecord> {
  const id = retentionPolicyDocId(orgId, collection);
  const data: Record<string, unknown> = {
    targetOrgId: orgId,
    targetCollection: collection,
    ...policy,
  };
  const existing = await getRetentionPolicy(ctx, collection, orgId);
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  if (existing) {
    await updateDocument(
      ctx,
      RETENTION_POLICIES_COLLECTION,
      { id, data, merge: false },
      PLATFORM_ORG_ID,
    );
  } else {
    await insertDocument(
      ctx,
      RETENTION_POLICIES_COLLECTION,
      { id, data },
      PLATFORM_ORG_ID,
    );
  }
  return { orgId, collection, ...policy };
}

export async function clearRetentionPolicy(
  ctx: DbStoreContext,
  collection: string,
  orgId: string,
): Promise<{ cleared: boolean }> {
  const id = retentionPolicyDocId(orgId, collection);
  const existing = await getRetentionPolicy(ctx, collection, orgId);
  if (!existing) return { cleared: false };
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  await deleteDocuments(
    ctx,
    RETENTION_POLICIES_COLLECTION,
    { id },
    PLATFORM_ORG_ID,
  );
  return { cleared: true };
}

export async function listRetentionPolicies(
  ctx: DbStoreContext,
): Promise<RetentionPolicyRecord[]> {
  await setRequestOrgId(ctx, PLATFORM_ORG_ID);
  const { items } = await queryCollection(
    ctx,
    RETENTION_POLICIES_COLLECTION,
    {},
    PLATFORM_ORG_ID,
  );
  return items.map(policyFromRow).filter((p) => p.orgId && p.collection);
}

function isExpiredByDocExpiresAt(row: DocumentRow, nowMs: number): boolean {
  const raw = row.data.expiresAt;
  if (typeof raw !== 'string' || raw.length === 0) return false;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return false;
  return ms < nowMs;
}

function isExpiredByTtl(
  row: DocumentRow,
  ttlSeconds: number,
  nowMs: number,
): boolean {
  const created = Date.parse(row.createdAt);
  if (Number.isNaN(created)) return false;
  return created < nowMs - ttlSeconds * 1000;
}

async function resolveEffectivePolicy(
  ctx: DbStoreContext,
  collection: string,
  orgId: string,
  policy: RetentionPolicy | null | undefined,
  orgConfig?: OrgRetentionRecord | null,
): Promise<RetentionPolicy | null> {
  const collectionPolicy =
    policy === undefined
      ? await getRetentionPolicy(ctx, collection, orgId)
      : policy;
  if (collectionPolicy) {
    if (
      collectionPolicy.ttlSeconds === undefined &&
      isOptedInForDefaultTtl(orgConfig, collection) &&
      orgConfig?.defaultTtlSeconds
    ) {
      return {
        ...collectionPolicy,
        ttlSeconds: orgConfig.defaultTtlSeconds,
      };
    }
    return collectionPolicy;
  }
  if (isOptedInForDefaultTtl(orgConfig, collection) && orgConfig) {
    return { ttlSeconds: orgConfig.defaultTtlSeconds };
  }
  return null;
}

/**
 * Prune a collection+org partition for time TTL, per-doc expiresAt, and maxCount.
 * Returns number of deleted rows. Legal hold → 423.
 */
export async function pruneCollection(
  ctx: DbStoreContext,
  collection: string,
  orgId: string,
  policy?: RetentionPolicy | null,
  now: Date = new Date(),
  options?: {
    skipLegalHoldCheck?: boolean;
    orgConfig?: OrgRetentionRecord | null;
  },
): Promise<{ deleted: number }> {
  if (
    collection === RETENTION_POLICIES_COLLECTION ||
    collection === ORG_RETENTION_COLLECTION
  ) {
    return { deleted: 0 };
  }

  if (!options?.skipLegalHoldCheck) {
    await assertNotOnLegalHold(ctx, orgId);
  }

  const orgConfig =
    options?.orgConfig !== undefined
      ? options.orgConfig
      : await getOrgRetention(ctx, orgId);

  const resolved = await resolveEffectivePolicy(
    ctx,
    collection,
    orgId,
    policy,
    orgConfig,
  );

  await setRequestOrgId(ctx, orgId);
  const { items } = await queryCollection(ctx, collection, {}, orgId);
  if (items.length === 0) return { deleted: 0 };

  const nowMs = now.getTime();
  const toDelete = new Set<string>();

  for (const row of items) {
    if (isExpiredByDocExpiresAt(row, nowMs)) {
      toDelete.add(row.id);
      continue;
    }
    if (
      resolved?.ttlSeconds !== undefined &&
      isExpiredByTtl(row, resolved.ttlSeconds, nowMs)
    ) {
      toDelete.add(row.id);
    }
  }

  const remaining = items.filter((row) => !toDelete.has(row.id));

  if (resolved?.maxCount !== undefined && resolved.maxCount > 0) {
    // Oldest first so equal createdAt (bulk insert) keeps later rows.
    const sorted = applySort(remaining, [
      { field: 'createdAt', direction: 'asc' },
    ]);
    const dropOldest = (list: DocumentRow[]) => {
      const overflow = Math.max(0, list.length - resolved.maxCount!);
      for (const row of list.slice(0, overflow)) {
        toDelete.add(row.id);
      }
    };
    if (resolved.maxCountGroupBy) {
      const field = resolved.maxCountGroupBy;
      const groups = new Map<string, DocumentRow[]>();
      for (const row of sorted) {
        const key = String(row.data[field] ?? '');
        const list = groups.get(key) ?? [];
        list.push(row);
        groups.set(key, list);
      }
      for (const list of groups.values()) {
        dropOldest(list);
      }
    } else {
      dropOldest(sorted);
    }
  }

  if (toDelete.size === 0) return { deleted: 0 };

  const ids = [...toDelete];
  // deleteDocuments already batches by id list
  return deleteDocuments(ctx, collection, { ids }, orgId);
}

/**
 * After a write: apply maxCount (+ groupBy) for the collection policy.
 * TTL / expiresAt are left to background or explicit prune.
 */
export async function pruneAfterWrite(
  ctx: DbStoreContext,
  collection: string,
  orgId: string,
): Promise<void> {
  const policy = await getRetentionPolicy(ctx, collection, orgId);
  if (!policy?.maxCount) return;
  const orgConfig = await getOrgRetention(ctx, orgId);
  // Legal hold: keep writes succeeding; skip destructive on-write prune.
  if (orgConfig?.legalHold) return;
  await setRequestOrgId(ctx, orgId);
  await pruneCollection(
    ctx,
    collection,
    orgId,
    {
      maxCount: policy.maxCount,
      maxCountGroupBy: policy.maxCountGroupBy,
    },
    new Date(),
    { skipLegalHoldCheck: true, orgConfig },
  );
}

/** Sweep every registered retention policy + org default-TTL opted-ins (background tick). */
export async function pruneAllPolicies(
  ctx: DbStoreContext,
  now: Date = new Date(),
): Promise<{ deleted: number; collections: number }> {
  const policies = await listRetentionPolicies(ctx);
  const orgConfigs = await listOrgRetentions(ctx);
  const heldOrgs = new Set(
    orgConfigs.filter((c) => c.legalHold).map((c) => c.orgId),
  );
  const orgById = new Map(orgConfigs.map((c) => [c.orgId, c]));

  let deleted = 0;
  let collections = 0;
  const pruned = new Set<string>();

  for (const policy of policies) {
    if (heldOrgs.has(policy.orgId)) continue;
    const key = `${policy.orgId}::${policy.collection}`;
    const result = await pruneCollection(
      ctx,
      policy.collection,
      policy.orgId,
      policy,
      now,
      {
        skipLegalHoldCheck: true,
        orgConfig: orgById.get(policy.orgId) ?? null,
      },
    );
    deleted += result.deleted;
    collections += 1;
    pruned.add(key);
  }

  for (const org of orgConfigs) {
    if (org.legalHold) continue;
    if (!org.defaultTtlSeconds || !org.optedInCollections?.length) continue;
    for (const collection of org.optedInCollections) {
      const key = `${org.orgId}::${collection}`;
      if (pruned.has(key)) continue;
      const result = await pruneCollection(
        ctx,
        collection,
        org.orgId,
        null,
        now,
        { skipLegalHoldCheck: true, orgConfig: org },
      );
      deleted += result.deleted;
      collections += 1;
      pruned.add(key);
    }
  }

  return { deleted, collections };
}
