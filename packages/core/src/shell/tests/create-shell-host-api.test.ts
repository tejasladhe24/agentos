import { beforeEach, describe, expect, test } from 'bun:test';
import {
  createShellHostApi,
  defaultEnabledById,
  defaultSkillsByExtension,
  resetShellHostApiStorage,
  STUB_EXTENSION_CATALOG,
  useShellStore,
} from '@agentos/core/shell/lib';

function resetStore() {
  useShellStore.setState({
    activeView: 'home',
    sidebarOpen: true,
    sidebarPanel: 'contribution',
    rightSidebarOpen: false,
    chatOpen: false,
    chatMessages: [],
    chatBusy: false,
    extensions: STUB_EXTENSION_CATALOG,
    enabledById: defaultEnabledById(),
    desiredContributions: [],
    contributions: [],
    runtimeStatus: {},
    desiredSkillsByExtension: defaultSkillsByExtension(),
    skillsByExtension: defaultSkillsByExtension(),
    statusText: null,
    statusTone: null,
  });
}

describe('createShellHostApi navigation', () => {
  test('openExternal opens http(s) URLs only', async () => {
    const api = createShellHostApi('files');
    const opened: unknown[][] = [];
    const assigned: string[] = [];
    const g = globalThis as { window?: unknown };
    const original = g.window;
    g.window = {
      open: (...args: unknown[]) => {
        opened.push(args);
        return null;
      },
      location: { assign: (url: string) => assigned.push(url) },
    };
    try {
      await api.navigation.openExternal('https://drive.google.com/x');
      expect(opened[0]).toEqual([
        'https://drive.google.com/x',
        '_blank',
        'noopener,noreferrer',
      ]);
      await api.navigation.openExternal('https://accounts.google.com/o', {
        sameTab: true,
      });
      expect(assigned).toEqual(['https://accounts.google.com/o']);
      await expect(
        api.navigation.openExternal('javascript:alert(1)'),
      ).rejects.toThrow('http(s)');
      await expect(api.navigation.openExternal('/relative')).rejects.toThrow(
        'absolute',
      );
    } finally {
      g.window = original;
    }
  });
});

describe('createShellHostApi notifications', () => {
  beforeEach(() => {
    resetStore();
    resetShellHostApiStorage();
  });

  test('notifications.show updates status text and tone', async () => {
    const host = createShellHostApi('crm');
    await host.notifications.show('saved', 'success');

    const state = useShellStore.getState();
    expect(state.statusText).toBe('saved');
    expect(state.statusTone).toBe('success');
  });

  test('notifications.show defaults type to info', async () => {
    const host = createShellHostApi('crm');
    await host.notifications.show('hello');

    const state = useShellStore.getState();
    expect(state.statusText).toBe('hello');
    expect(state.statusTone).toBe('info');
  });

  test('api.fetch proxies to /api/ext/:extensionId', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    try {
      const host = createShellHostApi('auth');
      const res = await host.api.fetch('/session');
      expect(calls).toEqual(['/api/ext/auth/session']);
      expect(res).toEqual({ ok: true, status: 200, body: '{"ok":true}' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('api.fetch keeps absolute /api/ext/* paths', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    try {
      const host = createShellHostApi('inbound-email');
      const res = await host.api.fetch('/api/ext/notifications/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: 'email', to: 'a@b.c', message: 'hi' }),
      });
      expect(calls).toEqual(['/api/ext/notifications/notify']);
      expect(res.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ai.generateText posts to /api/ext/ai/generate-text', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ text: 'echo:hi' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const host = createShellHostApi('crm');
      const res = await host.ai.generateText('hi');
      expect(res).toEqual({ text: 'echo:hi' });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('/api/ext/ai/generate-text');
      expect(calls[0]?.init?.method).toBe('POST');
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ prompt: 'hi' }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('notifications.show fans out to notifications builtin', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const host = createShellHostApi('crm');
      await host.notifications.show('ping', 'info');
      await new Promise((r) => setTimeout(r, 0));
      expect(calls.some((c) => c.url === '/api/ext/notifications/notify')).toBe(
        true,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('events.publish posts to events builtin', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const host = createShellHostApi('crm');
      await host.events.publish('demo', { n: 1 });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('/api/ext/events/publish');
      expect(calls[0]?.init?.body).toBe(
        JSON.stringify({ topic: 'demo', payload: { n: 1 } }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('hitl.requestApproval creates, opens inbox, and returns on resolve', async () => {
    const originalFetch = globalThis.fetch;
    let status: 'pending' | 'approved' = 'pending';
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url === '/api/ext/hitl/approvals' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'a1', status: 'pending', title: 'Pay' }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === '/api/ext/hitl/approvals') {
        const current = status;
        // Flip after first poll so the HostAPI loop completes.
        status = 'approved';
        return new Response(
          JSON.stringify({
            approvals: [{ id: 'a1', status: current, title: 'Pay' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const host = createShellHostApi('crm');
      const resultPromise = host.hitl.requestApproval({ title: 'Pay' });
      // Allow create + setSidebarPanel('hitl') to settle before asserting.
      await new Promise((r) => setTimeout(r, 0));
      expect(useShellStore.getState().sidebarPanel).toBe('hitl');
      const result = await resultPromise;
      expect(result).toEqual({ approved: true, id: 'a1' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ui right sidebar controls read and update Shell store', async () => {
    const host = createShellHostApi('files');
    expect(await host.ui.isRightSidebarOpen()).toBe(false);
    await host.ui.setRightSidebarOpen(true);
    expect(useShellStore.getState().rightSidebarOpen).toBe(true);
    expect(await host.ui.isRightSidebarOpen()).toBe(true);
    expect(await host.ui.toggleRightSidebar()).toBe(false);
    expect(useShellStore.getState().rightSidebarOpen).toBe(false);
  });
});
