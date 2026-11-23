import { CollectionError } from './collection-error';
import { compareScalars, type Scalar } from './where';

export type SortDirection = 'asc' | 'desc';

export type SortClause = {
  field: string;
  direction: SortDirection;
};

/** Document fields or row meta (`id`, `createdAt`, `updatedAt`). */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse `sort` as `{ field: 'asc'|'desc', ... }` (stable key order = priority).
 */
export function parseSort(sort: unknown): SortClause[] | undefined {
  if (sort === undefined || sort === null) return undefined;
  if (typeof sort !== 'object' || Array.isArray(sort)) {
    throw new CollectionError(
      "sort must be an object of { field: 'asc' | 'desc' }",
    );
  }
  const obj = sort as Record<string, unknown>;
  const clauses: SortClause[] = [];
  for (const [field, direction] of Object.entries(obj)) {
    if (!FIELD_NAME.test(field)) {
      throw new CollectionError(
        `sort.${field}: field names must be identifiers (A-Za-z0-9_)`,
      );
    }
    if (direction !== 'asc' && direction !== 'desc') {
      throw new CollectionError(
        `sort.${field}: direction must be 'asc' or 'desc'`,
      );
    }
    clauses.push({ field, direction });
  }
  return clauses.length > 0 ? clauses : undefined;
}

type SortableRow = {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function sortValue(row: SortableRow, field: string): Scalar | undefined {
  if (field === 'id') return row.id;
  if (field === 'createdAt') return row.createdAt;
  if (field === 'updatedAt') return row.updatedAt;
  const v = row.data[field];
  if (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  ) {
    return v;
  }
  return undefined;
}

export function applySort<T extends SortableRow>(
  items: T[],
  clauses: SortClause[] | undefined,
): T[] {
  if (!clauses || clauses.length === 0) return items;
  const copy = [...items];
  copy.sort((a, b) => {
    for (const { field, direction } of clauses) {
      const left = sortValue(a, field);
      const right = sortValue(b, field);
      if (left === undefined && right === undefined) continue;
      if (left === undefined) return direction === 'asc' ? 1 : -1;
      if (right === undefined) return direction === 'asc' ? -1 : 1;
      const cmp = compareScalars(left, right as Scalar);
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
  return copy;
}
