import { CollectionError } from './collection-error';

/** Allowlisted comparison operators (Mongo-style). */
export const WHERE_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
] as const;

export type WhereOperator = (typeof WHERE_OPERATORS)[number];

export type Scalar = string | number | boolean | null;

export type FieldPredicate =
  | { op: '$eq'; value: Scalar }
  | { op: '$ne'; value: Scalar }
  | { op: '$gt' | '$gte' | '$lt' | '$lte'; value: Scalar }
  | { op: '$in'; value: Scalar[] };

export type FieldClause = {
  field: string;
  predicates: FieldPredicate[];
};

const OPERATOR_SET = new Set<string>(WHERE_OPERATORS);

/** Top-level JSON `data` keys only: letters, digits, underscore. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertFieldName(field: string): void {
  if (!FIELD_NAME.test(field)) {
    throw new CollectionError(
      `where.${field}: field names must be top-level identifiers (A-Za-z0-9_)`,
    );
  }
}

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function assertScalar(value: unknown, label: string): Scalar {
  if (!isScalar(value)) {
    throw new CollectionError(
      `${label} must be a scalar (string|number|boolean|null)`,
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new CollectionError(`${label} must be a finite number`);
  }
  return value;
}

function parseOperatorObject(
  field: string,
  obj: Record<string, unknown>,
): FieldPredicate[] {
  const predicates: FieldPredicate[] = [];
  for (const [op, raw] of Object.entries(obj)) {
    if (!OPERATOR_SET.has(op)) {
      throw new CollectionError(`unsupported where operator: ${op}`);
    }
    const label = `where.${field}.${op}`;
    if (op === '$in') {
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new CollectionError(`${label} must be a non-empty array`);
      }
      predicates.push({
        op: '$in',
        value: raw.map((item, i) => assertScalar(item, `${label}[${i}]`)),
      });
      continue;
    }
    const value = assertScalar(raw, label);
    predicates.push({ op: op as Exclude<WhereOperator, '$in'>, value });
  }
  if (predicates.length === 0) {
    throw new CollectionError(
      `where.${field}: operator object must not be empty`,
    );
  }
  return predicates;
}

/**
 * Parse a Mongo-ish `where` object into field clauses.
 * Equality shorthand: `{ city: "London" }` → `$eq`.
 * Operators: `{ amount: { $gte: 10, $lt: 100 } }`.
 */
export function parseWhere(where: unknown): FieldClause[] | undefined {
  if (where === undefined || where === null) return undefined;
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new CollectionError(
      'where must be a JSON object of field filters (equality or $operators)',
    );
  }
  const obj = where as Record<string, unknown>;
  const clauses: FieldClause[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$')) {
      throw new CollectionError(
        `unsupported where operator: ${key} (operators belong under a field, e.g. { age: { $gt: 1 } })`,
      );
    }
    assertFieldName(key);

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      clauses.push({
        field: key,
        predicates: parseOperatorObject(key, value as Record<string, unknown>),
      });
      continue;
    }

    clauses.push({
      field: key,
      predicates: [{ op: '$eq', value: assertScalar(value, `where.${key}`) }],
    });
  }

  return clauses.length > 0 ? clauses : undefined;
}

/** Compare scalars for ordering / range. Numbers vs numbers; else string coerce. */
export function compareScalars(a: unknown, b: Scalar): number {
  if (a === b) return 0;
  if (typeof a === 'number' && typeof b === 'number') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  if (a === null || b === null) {
    if (a === null && b === null) return 0;
    return a === null ? -1 : 1;
  }
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchPredicate(actual: unknown, pred: FieldPredicate): boolean {
  switch (pred.op) {
    case '$eq':
      return Object.is(actual, pred.value) || actual === pred.value;
    case '$ne':
      return !(Object.is(actual, pred.value) || actual === pred.value);
    case '$in':
      return pred.value.some((v) => Object.is(actual, v) || actual === v);
    case '$gt':
      return (
        actual !== undefined &&
        actual !== null &&
        compareScalars(actual, pred.value) > 0
      );
    case '$gte':
      return (
        actual !== undefined &&
        actual !== null &&
        compareScalars(actual, pred.value) >= 0
      );
    case '$lt':
      return (
        actual !== undefined &&
        actual !== null &&
        compareScalars(actual, pred.value) < 0
      );
    case '$lte':
      return (
        actual !== undefined &&
        actual !== null &&
        compareScalars(actual, pred.value) <= 0
      );
  }
}

export function matchesWhere(
  data: Record<string, unknown>,
  clauses: FieldClause[] | undefined,
): boolean {
  if (!clauses) return true;
  for (const clause of clauses) {
    const actual = data[clause.field];
    for (const pred of clause.predicates) {
      if (!matchPredicate(actual, pred)) return false;
    }
  }
  return true;
}
