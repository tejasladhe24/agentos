import { CollectionError } from './collection-error';
import {
  deleteDocuments,
  queryCollection,
  updateDocument,
} from './collections';
import { setRequestOrgId, type DbStoreContext } from './create-db';
import { assertNotOnLegalHold } from './org-retention';

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REDACTED = '[redacted]';

export type SubjectCollectionTarget = {
  name: string;
  where: Record<string, unknown>;
  anonymizeFields?: string[];
};

export type SubjectDeleteInput = {
  subjectId: string;
  mode: 'delete' | 'anonymize';
  collections: SubjectCollectionTarget[];
  fileKeys?: string[];
  /** Optional actor for the audit entry. */
  actor?: string;
};

export type SubjectCollectionResult = {
  name: string;
  matched: number;
  deleted: number;
  anonymized: number;
};

export type SubjectFileResult = {
  key: string;
  ok: boolean;
  error?: string;
};

export type SubjectDeleteResult = {
  subjectId: string;
  mode: 'delete' | 'anonymize';
  orgId: string;
  collections: SubjectCollectionResult[];
  files: SubjectFileResult[];
  auditId?: string;
};

function resolvePeerBase(
  extId: string,
  overrideKeys: string[],
  env: Record<string, string | undefined> = Bun.env,
): string {
  for (const key of overrideKeys) {
    const value = env[key]?.trim();
    if (value) return value.replace(/\/$/, '');
  }
  const gateway = env.AGENT_OS_GLOBAL_GATEWAY_URL?.replace(/\/$/, '');
  if (gateway) return `${gateway}/api/ext/${extId}`;
  return `http://127.0.0.1:5173/api/ext/${extId}`;
}

function resolveFilesApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  return resolvePeerBase(
    'files',
    ['AGENT_OS_FILES_API_BASE', 'AGENT_OS_EXT_DB_STORE_FILES_API_BASE'],
    env,
  );
}

function resolveAuditApiBase(
  env: Record<string, string | undefined> = Bun.env,
): string {
  return resolvePeerBase(
    'audit',
    ['AGENT_OS_AUDIT_API_BASE', 'AGENT_OS_EXT_DB_STORE_AUDIT_API_BASE'],
    env,
  );
}

/** Validate and normalize the subject-delete request body. */
export function parseSubjectDeleteInput(
  body: Record<string, unknown>,
): SubjectDeleteInput {
  const subjectId =
    typeof body.subjectId === 'string' ? body.subjectId.trim() : '';
  if (!subjectId) {
    throw new CollectionError('subjectId is required');
  }

  const mode = body.mode === 'anonymize' ? 'anonymize' : 'delete';
  if (
    body.mode !== undefined &&
    body.mode !== 'delete' &&
    body.mode !== 'anonymize'
  ) {
    throw new CollectionError('mode must be "delete" or "anonymize"');
  }

  if (!Array.isArray(body.collections) || body.collections.length === 0) {
    if (!Array.isArray(body.fileKeys) || body.fileKeys.length === 0) {
      throw new CollectionError(
        'collections and/or fileKeys required for subject deletion',
      );
    }
  }

  const collections: SubjectCollectionTarget[] = [];
  if (Array.isArray(body.collections)) {
    for (const raw of body.collections) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new CollectionError('collections entries must be objects');
      }
      const entry = raw as Record<string, unknown>;
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name || !FIELD_NAME.test(name)) {
        throw new CollectionError(
          'collections[].name must be a collection identifier',
        );
      }
      if (
        !entry.where ||
        typeof entry.where !== 'object' ||
        Array.isArray(entry.where)
      ) {
        throw new CollectionError(`collections[].where required for ${name}`);
      }
      const target: SubjectCollectionTarget = {
        name,
        where: entry.where as Record<string, unknown>,
      };
      if (entry.anonymizeFields !== undefined) {
        if (!Array.isArray(entry.anonymizeFields)) {
          throw new CollectionError(
            'collections[].anonymizeFields must be an array',
          );
        }
        const fields: string[] = [];
        for (const f of entry.anonymizeFields) {
          if (typeof f !== 'string' || !FIELD_NAME.test(f)) {
            throw new CollectionError(
              'anonymizeFields entries must be field identifiers',
            );
          }
          fields.push(f);
        }
        target.anonymizeFields = fields;
      }
      if (
        mode === 'anonymize' &&
        (!target.anonymizeFields || target.anonymizeFields.length === 0)
      ) {
        throw new CollectionError(
          `anonymizeFields required for collection ${name} when mode=anonymize`,
        );
      }
      collections.push(target);
    }
  }

  const fileKeys = Array.isArray(body.fileKeys)
    ? body.fileKeys.filter(
        (k): k is string => typeof k === 'string' && k.length > 0,
      )
    : undefined;

  if (collections.length === 0 && (!fileKeys || fileKeys.length === 0)) {
    throw new CollectionError(
      'collections and/or fileKeys required for subject deletion',
    );
  }

  const actor =
    typeof body.actor === 'string' && body.actor.trim()
      ? body.actor.trim()
      : undefined;

  return { subjectId, mode, collections, fileKeys, actor };
}

async function deleteFileKey(
  key: string,
  orgId: string,
): Promise<SubjectFileResult> {
  const base = resolveFilesApiBase();
  const url = `${base}/blobs/${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-agentos-org-id': orgId },
    });
    if (!res.ok) {
      const detail = await res.text();
      return {
        key,
        ok: false,
        error: detail || res.statusText || `HTTP ${res.status}`,
      };
    }
    return { key, ok: true };
  } catch (error) {
    return {
      key,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function appendAuditEntry(input: {
  action: string;
  actor?: string;
  resource: string;
  orgId: string;
  meta: Record<string, unknown>;
}): Promise<string | undefined> {
  const base = resolveAuditApiBase();
  try {
    const res = await fetch(`${base}/entries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agentos-org-id': input.orgId,
      },
      body: JSON.stringify({
        action: input.action,
        actor: input.actor,
        resource: input.resource,
        meta: input.meta,
      }),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { id?: string };
    return typeof body.id === 'string' ? body.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Delete or anonymize matching docs for a subject, then delete explicit file keys.
 * Legal hold → 423. File failures are reported per-key (partial OK).
 */
export async function deleteSubject(
  ctx: DbStoreContext,
  orgId: string,
  input: SubjectDeleteInput,
): Promise<SubjectDeleteResult> {
  await assertNotOnLegalHold(ctx, orgId);

  const collectionResults: SubjectCollectionResult[] = [];

  for (const target of input.collections) {
    await setRequestOrgId(ctx, orgId);
    const { items } = await queryCollection(
      ctx,
      target.name,
      { where: target.where },
      orgId,
    );

    let deleted = 0;
    let anonymized = 0;

    if (items.length > 0) {
      if (input.mode === 'delete') {
        const result = await deleteDocuments(
          ctx,
          target.name,
          { ids: items.map((row) => row.id) },
          orgId,
        );
        deleted = result.deleted;
      } else {
        const fields = target.anonymizeFields ?? [];
        for (const row of items) {
          const patch: Record<string, unknown> = {};
          for (const field of fields) {
            patch[field] = REDACTED;
          }
          await updateDocument(
            ctx,
            target.name,
            { id: row.id, data: patch, merge: true },
            orgId,
          );
          anonymized += 1;
        }
      }
    }

    collectionResults.push({
      name: target.name,
      matched: items.length,
      deleted,
      anonymized,
    });
  }

  const files: SubjectFileResult[] = [];
  for (const key of input.fileKeys ?? []) {
    files.push(await deleteFileKey(key, orgId));
  }

  const action =
    input.mode === 'anonymize' ? 'subject.anonymize' : 'subject.delete';
  const auditId = await appendAuditEntry({
    action,
    actor: input.actor,
    resource: input.subjectId,
    orgId,
    meta: {
      orgId,
      mode: input.mode,
      collections: collectionResults,
      files,
    },
  });

  return {
    subjectId: input.subjectId,
    mode: input.mode,
    orgId,
    collections: collectionResults,
    files,
    auditId,
  };
}
