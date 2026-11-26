import { describe, expect, test } from 'bun:test';

import {
  filterEntries,
  formatRelativeTime,
  loadRecentNotifications,
  severityOf,
  sortNewestFirst,
  type InboxEntry,
} from '../ui/inbox-model';

const NOW = Date.parse('2026-11-26T12:00:00.000Z');

function entry(
  id: string,
  type: string,
  at: string,
  extra: Partial<InboxEntry> = {},
): InboxEntry {
  return { id, type, at, message: `message ${id}`, ...extra };
}

const ALL_SEVERITIES: InboxEntry[] = [
  entry('e', 'error', '2026-11-26T11:00:00.000Z'),
  entry('w', 'warning', '2026-11-26T11:30:00.000Z'),
  entry('s', 'success', '2026-11-26T11:45:00.000Z'),
  entry('i', 'info', '2026-11-26T11:55:00.000Z'),
];

describe('severityOf', () => {
  test('keeps known severities and maps unknown types to info', () => {
    expect(severityOf('error')).toBe('error');
    expect(severityOf('warning')).toBe('warning');
    expect(severityOf('success')).toBe('success');
    expect(severityOf('info')).toBe('info');
    expect(severityOf('something-new')).toBe('info');
  });
});

describe('filterEntries', () => {
  test('all returns every entry in order', () => {
    expect(filterEntries(ALL_SEVERITIES, 'all').map((e) => e.id)).toEqual([
      'e',
      'w',
      's',
      'i',
    ]);
  });

  test('each severity filter returns only matching entries', () => {
    for (const severity of ['error', 'warning', 'success', 'info'] as const) {
      const result = filterEntries(ALL_SEVERITIES, severity);
      expect(result.map((e) => e.type)).toEqual([severity]);
    }
  });

  test('unknown types only appear under info', () => {
    const rows = [entry('x', 'mystery', '2026-11-26T11:00:00.000Z')];
    expect(filterEntries(rows, 'info')).toHaveLength(1);
    expect(filterEntries(rows, 'error')).toHaveLength(0);
  });
});

describe('sortNewestFirst', () => {
  test('orders by timestamp descending and sends invalid dates last', () => {
    const sorted = sortNewestFirst([
      entry('old', 'info', '2026-11-25T00:00:00.000Z'),
      entry('bad', 'info', 'not-a-date'),
      entry('new', 'info', '2026-11-26T00:00:00.000Z'),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['new', 'old', 'bad']);
  });
});

describe('formatRelativeTime', () => {
  test('uses coarse buckets for recent times', () => {
    expect(formatRelativeTime('2026-11-26T11:59:30.000Z', NOW)).toBe(
      'just now',
    );
    expect(formatRelativeTime('2026-11-26T11:55:00.000Z', NOW)).toBe('5m ago');
    expect(formatRelativeTime('2026-11-26T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(formatRelativeTime('2026-11-24T12:00:00.000Z', NOW)).toBe('2d ago');
  });

  test('falls back to a locale date after a week', () => {
    const at = '2026-11-01T12:00:00.000Z';
    expect(formatRelativeTime(at, NOW)).toBe(new Date(at).toLocaleDateString());
  });

  test('returns unparseable input unchanged', () => {
    expect(formatRelativeTime('yesterday-ish', NOW)).toBe('yesterday-ish');
  });
});

describe('loadRecentNotifications', () => {
  test('returns normalized entries from the recent endpoint, newest first', async () => {
    const paths: string[] = [];
    const result = await loadRecentNotifications(async (path) => {
      paths.push(path);
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          notifications: [
            {
              id: 'a',
              message: 'Older',
              type: 'error',
              channel: 'in_app',
              status: 'sent',
              at: '2026-11-25T00:00:00.000Z',
              subject: 'Sync failed',
              error: 'timeout',
              extensionId: 'crm-helper',
            },
            {
              id: 'b',
              message: 'Newer',
              type: 'success',
              at: '2026-11-26T00:00:00.000Z',
            },
            { id: 'skip', type: 'info', at: '2026-11-26T00:00:00.000Z' },
            'not-an-object',
          ],
        }),
      };
    });

    expect(paths).toEqual(['/recent']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((e) => e.id)).toEqual(['b', 'a']);
    expect(result.entries[1]).toEqual({
      id: 'a',
      message: 'Older',
      type: 'error',
      at: '2026-11-25T00:00:00.000Z',
      subject: 'Sync failed',
      error: 'timeout',
      extensionId: 'crm-helper',
    });
  });

  test('omits extensionId when the API does not send it', async () => {
    const result = await loadRecentNotifications(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        notifications: [
          {
            id: 'n',
            message: 'Hi',
            type: 'info',
            at: '2026-11-26T00:00:00.000Z',
          },
        ],
      }),
    }));
    if (!result.ok) throw new Error(result.error);
    expect(result.entries[0]).not.toHaveProperty('extensionId');
  });

  test('returns an empty list when there are no notifications', async () => {
    const result = await loadRecentNotifications(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ notifications: [] }),
    }));
    expect(result).toEqual({ ok: true, entries: [] });
  });

  test('reports HTTP failures with the status code', async () => {
    const result = await loadRecentNotifications(async () => ({
      ok: false,
      status: 503,
      body: 'unavailable',
    }));
    expect(result).toEqual({
      ok: false,
      error: 'Could not load notifications (HTTP 503).',
    });
  });

  test('reports malformed payloads', async () => {
    const result = await loadRecentNotifications(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ items: [] }),
    }));
    expect(result.ok).toBe(false);
  });

  test('reports invalid JSON without throwing', async () => {
    const result = await loadRecentNotifications(async () => ({
      ok: true,
      status: 200,
      body: '<html>',
    }));
    expect(result.ok).toBe(false);
  });

  test('reports network errors without throwing', async () => {
    const result = await loadRecentNotifications(async () => {
      throw new Error('network down');
    });
    expect(result).toEqual({
      ok: false,
      error: 'Could not load notifications: network down',
    });
  });

  test('a later call sees newly arrived entries (refresh)', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      const notifications =
        calls === 1
          ? []
          : [
              {
                id: 'new',
                message: 'New one',
                type: 'error',
                at: '2026-11-26T00:00:00.000Z',
              },
            ];
      return { ok: true, status: 200, body: JSON.stringify({ notifications }) };
    };
    const first = await loadRecentNotifications(fetcher);
    const second = await loadRecentNotifications(fetcher);
    expect(first).toEqual({ ok: true, entries: [] });
    expect(second.ok && second.entries.map((e) => e.id)).toEqual(['new']);
  });
});
