import { describe, expect, test } from 'bun:test';

import {
  approvalSource,
  approvalsPath,
  formatRelativeTime,
  errorMessage,
  filterApprovals,
  formatMetadata,
  fuzzyMatch,
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

describe('fuzzy search', () => {
  const items: Approval[] = [
    {
      id: 'p1',
      title: 'Pay invoice INV-7',
      body: 'Vendor: Acme Corp',
      metadata: { source: 'invoice-bot' },
      status: 'pending',
      createdAt: '2026-11-26T10:00:00.000Z',
    },
    {
      id: 'p2',
      title: 'Send contract',
      body: 'MSA renewal for Globex',
      status: 'pending',
      createdAt: '2026-11-26T09:00:00.000Z',
    },
  ];

  test('fuzzyMatch matches ordered character subsequences across tokens', () => {
    expect(fuzzyMatch('py inv', 'Pay invoice INV-7')).toBe(true);
    expect(fuzzyMatch('acm 7', 'Pay invoice INV-7 Vendor: Acme Corp')).toBe(
      true,
    );
    expect(fuzzyMatch('xyz', 'Pay invoice')).toBe(false);
  });

  test('filterApprovals searches title, body, and metadata', () => {
    expect(filterApprovals(items, '').map((a) => a.id)).toEqual(['p1', 'p2']);
    expect(filterApprovals(items, 'acme corp').map((a) => a.id)).toEqual([
      'p1',
    ]);
    expect(filterApprovals(items, 'invbt').map((a) => a.id)).toEqual(['p1']);
    expect(filterApprovals(items, 'glbx').map((a) => a.id)).toEqual(['p2']);
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

describe('formatRelativeTime and approvalSource', () => {
  const now = Date.parse('2026-11-26T12:00:00.000Z');

  test('formats seconds, minutes, hours, and days relative to now', () => {
    expect(formatRelativeTime('2026-11-26T11:59:30.000Z', now)).toBe(
      '30 seconds ago',
    );
    expect(formatRelativeTime('2026-11-26T11:55:00.000Z', now)).toBe(
      '5 minutes ago',
    );
    expect(formatRelativeTime('2026-11-26T09:00:00.000Z', now)).toBe(
      '3 hours ago',
    );
    expect(formatRelativeTime('2026-11-25T12:00:00.000Z', now)).toBe(
      'yesterday',
    );
    expect(formatRelativeTime(undefined, now)).toBe('');
    expect(formatRelativeTime('not a date', now)).toBe('not a date');
  });

  test('approvalSource reads a non-empty string metadata.source only', () => {
    const base = {
      id: 'a',
      title: 't',
      status: 'pending' as const,
      createdAt: '',
    };
    expect(
      approvalSource({ ...base, metadata: { source: ' invoice-bot ' } }),
    ).toBe('invoice-bot');
    expect(approvalSource({ ...base, metadata: { source: 42 } })).toBe(
      undefined,
    );
    expect(approvalSource({ ...base, metadata: { source: ' ' } })).toBe(
      undefined,
    );
    expect(approvalSource(base)).toBe(undefined);
  });
});

describe('formatMetadata', () => {
  test('pretty-prints metadata as JSON', () => {
    expect(formatMetadata({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
