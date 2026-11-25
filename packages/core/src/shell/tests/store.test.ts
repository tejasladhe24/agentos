import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  defaultEnabledById,
  defaultSkillsByExtension,
  STUB_EXTENSION_CATALOG,
  STUB_SKILLS_BY_EXTENSION,
  useShellStore,
} from '@agentos/core/shell/lib';

function resetStore() {
  useShellStore.setState({
    activeView: 'home',
    sidebarOpen: true,
    sidebarPanel: 'contribution',
    chatOpen: false,
    chatMessages: [],
    chatBusy: false,
    extensions: STUB_EXTENSION_CATALOG,
    enabledById: defaultEnabledById(),
    desiredContributions: [],
    contributions: [],
    runtimeStatus: {},
    desiredSkillsByExtension: { ...STUB_SKILLS_BY_EXTENSION },
    skillsByExtension: defaultSkillsByExtension(),
    statusText: null,
    statusTone: null,
  });
}

const originalFetch = globalThis.fetch;

describe('useShellStore', () => {
  beforeEach(() => {
    resetStore();
    mock.restore();
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('fixture catalog seeds manager and skills', () => {
    const state = useShellStore.getState();
    expect(state.activeView).toBe('home');
    expect(state.sidebarOpen).toBe(true);
    expect(state.sidebarPanel).toBe('contribution');
    expect(state.contributions).toEqual([]);
    expect(state.runtimeStatus).toEqual({});
    expect(state.extensions.map((e) => e.id)).toContain('auth');
    expect(state.extensions.map((e) => e.id)).toContain('crm');
    expect(state.enabledById.auth).toBe(true);
    expect(state.enabledById.crm).toBe(true);
    expect(state.skillsByExtension.crm).toEqual(STUB_SKILLS_BY_EXTENSION.crm);
    expect(state.statusText).toBeNull();
  });

  test('setContributions and setRuntimeStatus track iframe host state', () => {
    useShellStore
      .getState()
      .setContributions([
        { extensionId: 'crm', view: 'page', src: '/crm.html' },
      ]);
    useShellStore.getState().setRuntimeStatus('crm', 'page', 'loading');
    useShellStore.getState().setRuntimeStatus('crm', 'page', 'active');

    const state = useShellStore.getState();
    expect(state.contributions).toHaveLength(1);
    expect(state.desiredContributions).toHaveLength(1);
    expect(state.runtimeStatus['crm:page']).toBe('active');
  });

  test('crashed status does not clear sibling contributions', () => {
    useShellStore.getState().setContributions([
      { extensionId: 'a', view: 'page', src: '/a.html' },
      { extensionId: 'b', view: 'page', src: '/b.html' },
    ]);
    useShellStore.getState().setRuntimeStatus('a', 'page', 'crashed');
    useShellStore.getState().setRuntimeStatus('b', 'page', 'active');

    const state = useShellStore.getState();
    expect(state.contributions).toHaveLength(2);
    expect(state.runtimeStatus['a:page']).toBe('crashed');
    expect(state.runtimeStatus['b:page']).toBe('active');
  });

  test('setActiveView updates active view and clears shell panels', () => {
    useShellStore.getState().setSidebarPanel('extensions');
    useShellStore.getState().setActiveView('ext-placeholder');
    expect(useShellStore.getState().activeView).toBe('ext-placeholder');
    expect(useShellStore.getState().sidebarPanel).toBe('contribution');
  });

  test('toggleSidebar and setSidebarPanel manage left sidebar host', () => {
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarOpen).toBe(false);
    useShellStore.getState().setSidebarPanel('extensions');
    expect(useShellStore.getState().sidebarPanel).toBe('extensions');
    expect(useShellStore.getState().sidebarOpen).toBe(true);
    useShellStore.getState().setSidebarPanel('contribution');
    expect(useShellStore.getState().sidebarPanel).toBe('contribution');
  });

  test('extensions and HITL panels are mutually exclusive and force sidebar open', () => {
    useShellStore.getState().setSidebarOpen(false);
    useShellStore.getState().setSidebarPanel('extensions');
    expect(useShellStore.getState().sidebarPanel).toBe('extensions');
    expect(useShellStore.getState().sidebarOpen).toBe(true);

    useShellStore.getState().setSidebarPanel('hitl');
    expect(useShellStore.getState().sidebarPanel).toBe('hitl');
    expect(useShellStore.getState().sidebarOpen).toBe(true);
  });

  test('customer disable unmounts contributions and clears skills', () => {
    useShellStore.getState().setContributions([
      { extensionId: 'crm', view: 'page', src: '/crm.html' },
      { extensionId: 'crm', view: 'sidebar', src: '/crm-side.html' },
      { extensionId: 'invoices', view: 'page', src: '/inv.html' },
    ]);
    useShellStore.getState().setExtensionSkills('crm', ['search-contacts']);
    useShellStore.getState().setRuntimeStatus('crm', 'page', 'active');
    useShellStore.getState().setExtensionEnabled('crm', false);

    const state = useShellStore.getState();
    expect(state.enabledById.crm).toBe(false);
    expect(state.contributions).toEqual([
      { extensionId: 'invoices', view: 'page', src: '/inv.html' },
    ]);
    expect(state.desiredContributions).toHaveLength(3);
    expect(state.skillsByExtension.crm).toBeUndefined();
    expect(state.runtimeStatus['crm:page']).toBeUndefined();
  });

  test('customer re-enable restores contributions and desired skills', () => {
    useShellStore.getState().setContributions([
      { extensionId: 'crm', view: 'page', src: '/crm.html' },
      { extensionId: 'invoices', view: 'page', src: '/inv.html' },
    ]);
    useShellStore.getState().setExtensionEnabled('crm', false);
    expect(useShellStore.getState().contributions).toHaveLength(1);
    expect(useShellStore.getState().skillsByExtension.crm).toBeUndefined();

    useShellStore.getState().setExtensionEnabled('crm', true);
    expect(useShellStore.getState().enabledById.crm).toBe(true);
    expect(useShellStore.getState().contributions).toHaveLength(2);
    expect(useShellStore.getState().skillsByExtension.crm).toEqual(
      STUB_SKILLS_BY_EXTENSION.crm,
    );
  });

  test('setStatusText updates status bar fields', () => {
    useShellStore.getState().setStatusText('ok', 'success');
    expect(useShellStore.getState().statusText).toBe('ok');
    expect(useShellStore.getState().statusTone).toBe('success');
    useShellStore.getState().setStatusText(null);
    expect(useShellStore.getState().statusText).toBeNull();
    expect(useShellStore.getState().statusTone).toBeNull();
  });

  test('builtins cannot be toggled off', () => {
    for (const id of ['auth', 'db-store', 'cache-store', 'ai'] as const) {
      useShellStore.getState().setExtensionEnabled(id, false);
      expect(useShellStore.getState().enabledById[id]).toBe(true);
    }
  });

  test('setExtensionEnabled calls stub enable API', () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    useShellStore.getState().setExtensionEnabled('crm', false);
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/extensions/crm/enable');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
  });

  test('hydrateEnabledById applies gateway overrides; builtins stay on', () => {
    useShellStore.getState().setContributions([
      { extensionId: 'crm', view: 'page', src: '/crm.html' },
      { extensionId: 'invoices', view: 'page', src: '/inv.html' },
    ]);
    useShellStore.getState().setRuntimeStatus('crm', 'page', 'active');

    useShellStore.getState().hydrateEnabledById({
      crm: false,
      auth: false,
    });

    const state = useShellStore.getState();
    expect(state.enabledById.crm).toBe(false);
    expect(state.enabledById.auth).toBe(true);
    expect(state.contributions).toEqual([
      { extensionId: 'invoices', view: 'page', src: '/inv.html' },
    ]);
    expect(state.runtimeStatus['crm:page']).toBeUndefined();
    expect(state.skillsByExtension.crm).toBeUndefined();
  });
});
