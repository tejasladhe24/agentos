import { describe, expect, test } from 'bun:test';

import { CollectionError } from '../api/lib/collection-error';
import { matchesWhere, parseWhere } from '../api/lib/where';
import { applySort, parseSort } from '../api/lib/sort';

describe('db-store where parse', () => {
  test('equality shorthand', () => {
    const clauses = parseWhere({ city: 'London', active: true });
    expect(clauses).toEqual([
      { field: 'city', predicates: [{ op: '$eq', value: 'London' }] },
      { field: 'active', predicates: [{ op: '$eq', value: true }] },
    ]);
  });

  test('nested operators', () => {
    const clauses = parseWhere({
      amount: { $gte: 10, $lt: 100 },
      status: { $in: ['open', 'held'] },
    });
    expect(clauses?.[0]?.predicates.map((p) => p.op)).toEqual(['$gte', '$lt']);
    expect(clauses?.[1]?.predicates[0]).toEqual({
      op: '$in',
      value: ['open', 'held'],
    });
  });

  test('rejects top-level operators', () => {
    expect(() => parseWhere({ $gt: { age: 1 } })).toThrow(CollectionError);
  });

  test('rejects unknown operators', () => {
    expect(() => parseWhere({ age: { $regex: 'x' } })).toThrow(/unsupported/);
  });

  test('rejects empty $in', () => {
    expect(() => parseWhere({ status: { $in: [] } })).toThrow(/non-empty/);
  });
});

describe('db-store where match', () => {
  test('range + in + ne', () => {
    const clauses = parseWhere({
      amount: { $gte: 10, $lt: 50 },
      status: { $in: ['open'] },
      archived: { $ne: true },
    });
    expect(
      matchesWhere({ amount: 10, status: 'open', archived: false }, clauses),
    ).toBe(true);
    expect(
      matchesWhere({ amount: 50, status: 'open', archived: false }, clauses),
    ).toBe(false);
    expect(
      matchesWhere({ amount: 20, status: 'closed', archived: false }, clauses),
    ).toBe(false);
    expect(
      matchesWhere({ amount: 20, status: 'open', archived: true }, clauses),
    ).toBe(false);
  });

  test('ISO date strings compare lexicographically', () => {
    const clauses = parseWhere({
      expiryAt: { $lt: '2026-06-01T00:00:00.000Z' },
    });
    expect(
      matchesWhere({ expiryAt: '2026-01-01T00:00:00.000Z' }, clauses),
    ).toBe(true);
    expect(
      matchesWhere({ expiryAt: '2026-12-01T00:00:00.000Z' }, clauses),
    ).toBe(false);
  });
});

describe('db-store sort', () => {
  test('sort by document field then meta', () => {
    const rows = [
      {
        id: 'b',
        data: { amount: 2 },
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'a',
        data: { amount: 1 },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'c',
        data: { amount: 2 },
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    ];
    const sorted = applySort(rows, parseSort({ amount: 'asc', id: 'asc' }));
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('rejects bad direction', () => {
    expect(() => parseSort({ amount: 'up' })).toThrow(CollectionError);
  });
});
