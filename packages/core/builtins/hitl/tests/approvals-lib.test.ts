import { describe, expect, test } from 'bun:test';

import {
  approvalsPath,
  errorMessage,
  formatMetadata,
  parseApprovals,
  resolvePath,
  sortNewestFirst,
  type Approval,
} from '../ui/lib/approvals';

describe('approvals paths', () => {
  test('status tabs map to the list query; All omits the filter', () => {
    expect(approvalsPath('pending')).toBe('/approvals?status=pending');
    expect(approvalsPath('approved')).toBe('/approvals?status=approved');
    expect(approvalsPath('rejected')).toBe('/approvals?status=rejected');
    expect(approvalsPath('all')).toBe('/approvals');
  });

  test('resolve path encodes the approval id', () => {
    expect(resolvePath('abc-123')).toBe('/approvals/abc-123/resolve');
    expect(resolvePath('a/b')).toBe('/approvals/a%2Fb/resolve');
  });
});

describe('parseApprovals', () => {
  test('keeps well-formed rows with body, metadata, and timestamps', () => {
    const body = JSON.stringify({
      approvals: [
        {
          id: 'a1',
          title: 'Pay invoice',
          body: 'Net 30',
          metadata: { amount: 120 },
          status: 'pending',
          createdAt: '2026-11-26T10:00:00.000Z',
        },
        {
          id: 'a2',
          title: 'Ship',
          status: 'approved',
          createdAt: '2026-11-26T09:00:00.000Z',
          resolvedAt: '2026-11-26T09:05:00.000Z',
        },
      ],
    });
    const rows = parseApprovals(body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 'a1',
      title: 'Pay invoice',
      body: 'Net 30',
      metadata: { amount: 120 },
      status: 'pending',
      createdAt: '2026-11-26T10:00:00.000Z',
    });
    expect(rows[1]?.resolvedAt).toBe('2026-11-26T09:05:00.000Z');
  });

  test('drops rows with an unknown status or missing id/title', () => {
    const rows = parseApprovals(
      JSON.stringify({
        approvals: [
          { id: 'x', title: 'Bad status', status: 'maybe' },
          { title: 'No id', status: 'pending' },
          { id: 'y', status: 'pending' },
          null,
          { id: 'ok', title: 'Fine', status: 'rejected' },
        ],
      }),
    );
    expect(rows.map((r) => r.id)).toEqual(['ok']);
  });

  test('returns an empty list for invalid JSON or a missing array', () => {
    expect(parseApprovals('not json')).toEqual([]);
    expect(parseApprovals('{}')).toEqual([]);
    expect(parseApprovals('{"approvals":"nope"}')).toEqual([]);
  });

  test('ignores non-object metadata', () => {
    const [row] = parseApprovals(
      JSON.stringify({
        approvals: [
          {
            id: 'm',
            title: 'List metadata',
            status: 'pending',
            metadata: ['not', 'an', 'object'],
          },
        ],
      }),
    );
    expect(row?.metadata).toBeUndefined();
  });
});

describe('sortNewestFirst', () => {
  test('orders by request time, newest first', () => {
    const base = { title: 't', status: 'pending' as const };
    const sorted = sortNewestFirst([
      { ...base, id: 'old', createdAt: '2026-11-26T08:00:00.000Z' },
      { ...base, id: 'new', createdAt: '2026-11-26T10:00:00.000Z' },
      { ...base, id: 'mid', createdAt: '2026-11-26T09:00:00.000Z' },
    ] as Approval[]);
    expect(sorted.map((a) => a.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('errorMessage', () => {
  test('prefers the API error and detail', () => {
    expect(
      errorMessage(
        502,
        JSON.stringify({ error: 'db-store unavailable', detail: 'timeout' }),
      ),
    ).toBe('db-store unavailable: timeout');
  });

  test('falls back to the plain body, then the status', () => {
    expect(errorMessage(409, '{"error":"already resolved"}')).toBe(
      'already resolved',
    );
    expect(errorMessage(500, 'boom')).toBe('boom');
    expect(errorMessage(500, '  ')).toBe('Request failed (500)');
  });
});

describe('formatMetadata', () => {
  test('pretty-prints metadata as JSON', () => {
    expect(formatMetadata({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
