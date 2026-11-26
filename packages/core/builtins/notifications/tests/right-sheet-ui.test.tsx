import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HostProvider } from '@agentos/core/client';
import type { HostAPIClient } from '@agentos/core/sdk';

import type { InboxEntry, InboxState } from '../ui/inbox-model';
import NotificationsRightSheet from '../ui/right-sheet';
import { NotificationsInbox } from '../ui/notifications-inbox';

const NOW = Date.parse('2026-11-26T12:00:00.000Z');

const ENTRIES: InboxEntry[] = [
  {
    id: 'err',
    type: 'error',
    message: 'Sync failed for Acme',
    subject: 'CRM sync',
    error: 'timeout after 30s',
    at: '2026-11-26T11:55:00.000Z',
    extensionId: 'crm-helper',
  },
  {
    id: 'warn',
    type: 'warning',
    message: 'Quota at 90%',
    at: '2026-11-26T11:00:00.000Z',
  },
  {
    id: 'ok',
    type: 'success',
    message: 'Invoice sent',
    at: '2026-11-26T10:00:00.000Z',
  },
  {
    id: 'info',
    type: 'info',
    message: 'Welcome back',
    at: '2026-11-25T10:00:00.000Z',
  },
];

function ready(entries: InboxEntry[]): InboxState {
  return { status: 'ready', entries };
}

function renderInbox(
  overrides: Partial<{
    state: InboxState;
    filter: 'all' | 'error' | 'warning' | 'info' | 'success';
  }> = {},
) {
  return renderToStaticMarkup(
    createElement(NotificationsInbox, {
      state: overrides.state ?? ready(ENTRIES),
      filter: overrides.filter ?? 'all',
      now: NOW,
      onFilterChange: () => {},
      onRefresh: () => {},
    }),
  );
}

function refreshButtonTag(html: string): string {
  return (
    html.match(/<button[^>]*data-slot="notifications-refresh"[^>]*>/)?.[0] ?? ''
  );
}

function createTestHost(
  fetchImpl: HostAPIClient['api']['fetch'],
): HostAPIClient {
  const store = new Map<string, unknown>();
  return {
    storage: {
      get: async (key) => (store.has(key) ? (store.get(key) as never) : null),
      set: async (key, value) => {
        store.set(key, value);
      },
      remove: async (key) => {
        store.delete(key);
      },
    },
    notifications: { show: async () => {} },
    ai: { generateText: async () => ({ text: '' }) },
    hitl: {
      requestApproval: async () => ({ approved: true, id: '1' }),
    },
    api: { fetch: fetchImpl },
    events: { publish: async () => {} },
    navigation: { openExternal: async () => {} },
    ui: {
      setRightSidebarOpen: async () => {},
      toggleRightSidebar: async () => false,
      isRightSidebarOpen: async () => false,
    },
  };
}

describe('NotificationsRightSheet container', () => {
  test('renders the loading state before the first response', () => {
    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        host: createTestHost(async () => ({
          ok: true,
          status: 200,
          body: JSON.stringify({ notifications: [] }),
        })),
        children: createElement(NotificationsRightSheet),
      }),
    );
    expect(html).toContain('data-slot="notifications-right-sheet"');
    expect(html).toContain('Loading notifications');
    expect(html).not.toContain('data-slot="notification-row"');
  });
});

describe('NotificationsInbox', () => {
  test('loading state shows spinner text and no rows', () => {
    const html = renderInbox({ state: { status: 'loading', entries: [] } });
    expect(html).toContain('Loading notifications');
    expect(html).toContain('data-status="loading"');
    expect(html).not.toContain('data-slot="notification-row"');
  });

  test('empty state when there are no notifications', () => {
    const html = renderInbox({ state: ready([]) });
    expect(html).toContain('No notifications yet');
    expect(html).not.toContain('data-slot="notifications-list"');
  });

  test('populated list renders every severity with badges and timestamps', () => {
    const html = renderInbox();
    expect(html).toContain('data-slot="notifications-list"');
    for (const severity of ['error', 'warning', 'success', 'info']) {
      expect(html).toContain(`data-severity="${severity}"`);
    }
    expect(html).toContain('Sync failed for Acme');
    expect(html).toContain('CRM sync');
    expect(html).toContain('timeout after 30s');
    expect(html).toContain('5m ago');
    expect(html).toContain('dateTime="2026-11-26T11:55:00.000Z"');
  });

  test('source extension badge renders only when extensionId is present', () => {
    const withSource = renderInbox();
    expect(withSource).toContain('data-slot="notification-source"');
    expect(withSource).toContain('crm-helper');

    const withoutSource = renderInbox({
      state: ready([ENTRIES[1] as InboxEntry]),
    });
    expect(withoutSource).not.toContain('data-slot="notification-source"');
  });

  test('severity filter shows only matching rows', () => {
    const html = renderInbox({ filter: 'error' });
    expect(html).toContain('Sync failed for Acme');
    expect(html).not.toContain('Quota at 90%');
    expect(html).not.toContain('Invoice sent');
    expect(html).toContain('data-filter="error"');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-filter="error"/);
  });

  test('filter with no matches shows a filter-specific empty message', () => {
    const html = renderInbox({
      state: ready([ENTRIES[2] as InboxEntry]),
      filter: 'warning',
    });
    expect(html).toContain('No warning notifications');
    expect(html).not.toContain('data-slot="notification-row"');
  });

  test('each filter control is present and the active one is pressed', () => {
    const html = renderInbox({ filter: 'success' });
    for (const id of ['all', 'error', 'warning', 'info', 'success']) {
      expect(html).toContain(`data-filter="${id}"`);
    }
    expect(html).toMatch(/aria-pressed="true"[^>]*data-filter="success"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-filter="all"/);
  });

  test('refresh control is labelled and enabled once loaded', () => {
    const html = renderInbox();
    expect(html).toContain('aria-label="Refresh notifications"');
    expect(refreshButtonTag(html)).not.toContain('disabled=""');
  });

  test('refresh control is disabled while a load is in flight', () => {
    const html = renderInbox({ state: { status: 'loading', entries: [] } });
    expect(refreshButtonTag(html)).toContain('disabled=""');
  });

  test('full error state when nothing could be loaded', () => {
    const html = renderInbox({
      state: {
        status: 'error',
        entries: [],
        error: 'Could not load notifications (HTTP 503).',
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load notifications (HTTP 503).');
    expect(html).toContain('Try again');
    expect(html).not.toContain('data-slot="notifications-list"');
  });

  test('error after a good load keeps the list and shows a banner', () => {
    const html = renderInbox({
      state: {
        status: 'error',
        entries: ENTRIES,
        error: 'Could not load notifications: network down',
      },
    });
    expect(html).toContain('data-slot="notifications-error"');
    expect(html).toContain('network down');
    expect(html).toContain('data-slot="notifications-list"');
    expect(html).toContain('Sync failed for Acme');
  });
});
