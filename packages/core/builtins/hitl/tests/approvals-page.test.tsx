import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HostProvider } from '@agentos/core/client';
import type { HostAPIClient } from '@agentos/core/sdk';

import ApprovalsPage from '../ui/page';
import { ApprovalCard } from '../ui/components/approval-card';
import {
  fetchApprovals,
  resolveApproval,
  type ApprovalsFetch,
} from '../ui/lib/approvals-api';
import type { Approval } from '../ui/lib/approvals';

type FetchCall = { path: string; method?: string; body?: string };

function createTestHost(
  respond: (
    path: string,
    method: string,
  ) => {
    ok: boolean;
    status: number;
    body: string;
  },
  calls: FetchCall[] = [],
  notices: Array<{ message: string; type?: string }> = [],
): HostAPIClient {
  const fetchImpl: ApprovalsFetch = async (path, init) => {
    calls.push({ path, method: init?.method, body: init?.body });
    return respond(path, init?.method ?? 'GET');
  };
  return {
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    notifications: {
      show: async (message: string, type?: string) => {
        notices.push({ message, type });
      },
    },
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
  } as unknown as HostAPIClient;
}

const PENDING: Approval = {
  id: 'p1',
  title: 'Pay invoice INV-7',
  body: 'Vendor: Acme\nAmount: 120 USD',
  metadata: { invoiceId: 'INV-7', source: 'invoice-bot' },
  status: 'pending',
  createdAt: '2026-11-26T10:00:00.000Z',
};

const APPROVED: Approval = {
  id: 'a1',
  title: 'Send contract',
  status: 'approved',
  createdAt: '2026-11-26T08:00:00.000Z',
  resolvedAt: '2026-11-26T08:30:00.000Z',
};

describe('fetchApprovals', () => {
  test('requests the status tab and returns newest-first rows', async () => {
    const calls: FetchCall[] = [];
    const host = createTestHost(
      () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ approvals: [APPROVED, PENDING] }),
      }),
      calls,
    );
    const rows = await fetchApprovals(host.api.fetch, 'pending');
    expect(calls[0]?.path).toBe('/approvals?status=pending');
    expect(rows.map((r) => r.id)).toEqual(['p1', 'a1']);
  });

  test('All tab omits the status filter', async () => {
    const calls: FetchCall[] = [];
    const host = createTestHost(
      () => ({ ok: true, status: 200, body: '{"approvals":[]}' }),
      calls,
    );
    await fetchApprovals(host.api.fetch, 'all');
    expect(calls[0]?.path).toBe('/approvals');
  });

  test('throws the API error for a failed response', async () => {
    const host = createTestHost(() => ({
      ok: false,
      status: 502,
      body: JSON.stringify({ error: 'db-store unavailable' }),
    }));
    await expect(fetchApprovals(host.api.fetch, 'pending')).rejects.toThrow(
      'db-store unavailable',
    );
  });
});

describe('resolveApproval', () => {
  test('POSTs the decision to the resolve route', async () => {
    const calls: FetchCall[] = [];
    const host = createTestHost(
      () => ({ ok: true, status: 200, body: '{}' }),
      calls,
    );
    await resolveApproval(host.api.fetch, 'p1', 'approved');
    expect(calls).toEqual([
      {
        path: '/approvals/p1/resolve',
        method: 'POST',
        body: '{"decision":"approved"}',
      },
    ]);
  });

  test('surfaces a 409 when the request was already resolved', async () => {
    const host = createTestHost(() => ({
      ok: false,
      status: 409,
      body: JSON.stringify({ error: 'already resolved' }),
    }));
    await expect(
      resolveApproval(host.api.fetch, 'p1', 'rejected'),
    ).rejects.toThrow('already resolved');
  });
});

describe('ApprovalCard', () => {
  test('pending card shows message, source, relative time, and hover Approve/Cancel; no badge, icon, or metadata JSON', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, {
        approval: PENDING,
        busy: false,
        onResolve: () => {},
      }),
    );
    expect(html).toContain('Pay invoice INV-7');
    expect(html).toContain('Vendor: Acme');
    expect(html).toContain('Requested');
    expect(html).toContain('via invoice-bot');
    expect(html).toContain('data-slot="alert"');
    expect(html).toContain('data-slot="alert-action"');
    expect(html).toContain('group-hover/alert:opacity-100');
    expect(html).toContain('Approve');
    expect(html).toContain('Cancel');
    expect(html).toContain('data-status="pending"');
    expect(html).not.toContain('data-slot="badge"');
    expect(html).not.toContain('<svg');
    // Raw metadata is never shown to users.
    expect(html).not.toContain('invoiceId');
    expect(html).not.toContain('Metadata');
  });

  test('resolved card shows the outcome badge and resolve time, with no actions', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, {
        approval: APPROVED,
        busy: false,
        onResolve: () => {},
      }),
    );
    expect(html).toContain('Resolved');
    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('>Approved<');
    expect(html).not.toContain('>Approve<');
    expect(html).not.toContain('>Cancel<');
  });

  test('busy pending card disables both actions and keeps them visible', () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, {
        approval: PENDING,
        busy: true,
        onResolve: () => {},
      }),
    );
    // Match the native attribute only (not `data-disabled`).
    expect(html.match(/ disabled=""/g)?.length).toBe(2);
    expect(html).not.toContain('opacity-0');
  });
});

describe('ApprovalsPage', () => {
  test('renders max-w-screen-md container, fuzzy search, status tabs, and loading state', () => {
    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        host: createTestHost(() => ({ ok: true, status: 200, body: '{}' })),
        children: createElement(ApprovalsPage),
      }),
    );
    expect(html).toContain('data-slot="approvals-page"');
    expect(html).toContain('max-w-screen-md');
    expect(html).toContain('Search approvals');
    expect(html).toContain('Approvals');
    expect(html).toContain('Loading approvals…');
    for (const label of ['Pending', 'Approved', 'Rejected', 'All']) {
      expect(html).toContain(label);
    }
  });
});
