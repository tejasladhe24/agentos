import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  defaultEnabledById,
  type ExtensionEntry,
  mapRegistry,
  useShellStore,
  type UiContribution,
} from '@agentos/core/shell/lib';
import type { RegistryModel } from '@agentos/core/vite/lib/types';

const notesEntry: ExtensionEntry = {
  id: 'notes',
  name: 'Notes',
  kind: 'customer',
  toggleable: true,
  driven: false,
};

const reportsEntry: ExtensionEntry = {
  id: 'reports',
  name: 'Reports',
  kind: 'customer',
  toggleable: true,
  driven: false,
};

const contributions: UiContribution[] = [
  {
    extensionId: 'notes',
    view: 'right-sheet',
    src: '/__agentos/ext/notes/right-sheet.html',
  },
  {
    extensionId: 'reports',
    view: 'right-sheet',
    src: '/__agentos/ext/reports/right-sheet.html',
  },
  {
    extensionId: 'notes',
    view: 'page',
    src: '/__agentos/ext/notes/page.html',
  },
];

function resetStore(desired: UiContribution[] = contributions) {
  useShellStore.setState({
    activeView: 'home',
    sidebarOpen: true,
    sidebarPanel: 'contribution',
    rightSidebarOpen: false,
    activeRightSheet: null,
    chatOpen: false,
    chatMessages: [],
    chatBusy: false,
    extensions: [notesEntry, reportsEntry],
    enabledById: { ...defaultEnabledById([notesEntry, reportsEntry]) },
    desiredContributions: [],
    contributions: [],
    runtimeStatus: {},
    desiredSkillsByExtension: {},
    skillsByExtension: {},
    statusText: null,
    statusTone: null,
  });
  useShellStore.getState().setContributions(desired);
}

const originalFetch = globalThis.fetch;

describe('useShellStore right sheet', () => {
  beforeEach(() => {
    resetStore();
    mock.restore();
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('starts closed', () => {
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('openRightSheet opens an extension that has a right-sheet contribution', () => {
    useShellStore.getState().openRightSheet('notes');
    expect(useShellStore.getState().activeRightSheet).toBe('notes');
  });

  test('openRightSheet is a no-op without a right-sheet contribution', () => {
    useShellStore.getState().openRightSheet('missing');
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('a page-only contribution does not count as a right sheet', () => {
    resetStore([
      {
        extensionId: 'notes',
        view: 'page',
        src: '/__agentos/ext/notes/page.html',
      },
    ]);
    useShellStore.getState().openRightSheet('notes');
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('only one sheet is open at a time: opening another replaces it', () => {
    useShellStore.getState().openRightSheet('notes');
    useShellStore.getState().openRightSheet('reports');
    expect(useShellStore.getState().activeRightSheet).toBe('reports');
  });

  test('toggleRightSheet opens, then closes the same extension', () => {
    useShellStore.getState().toggleRightSheet('notes');
    expect(useShellStore.getState().activeRightSheet).toBe('notes');
    useShellStore.getState().toggleRightSheet('notes');
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('toggleRightSheet on another extension switches the sheet', () => {
    useShellStore.getState().toggleRightSheet('notes');
    useShellStore.getState().toggleRightSheet('reports');
    expect(useShellStore.getState().activeRightSheet).toBe('reports');
  });

  test('closeRightSheet clears the active sheet', () => {
    useShellStore.getState().openRightSheet('notes');
    useShellStore.getState().closeRightSheet();
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('disabling the active sheet extension closes the sheet', () => {
    useShellStore.getState().openRightSheet('notes');
    useShellStore.getState().setExtensionEnabled('notes', false);
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('disabling a different extension leaves the active sheet open', () => {
    useShellStore.getState().openRightSheet('notes');
    useShellStore.getState().setExtensionEnabled('reports', false);
    expect(useShellStore.getState().activeRightSheet).toBe('notes');
  });

  test('hydrating a gateway disable for the active sheet closes it', () => {
    useShellStore.getState().openRightSheet('notes');
    useShellStore.getState().hydrateEnabledById({ notes: false });
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('removing the active right-sheet contribution closes the sheet', () => {
    useShellStore.getState().openRightSheet('notes');
    useShellStore.getState().setContributions([
      {
        extensionId: 'reports',
        view: 'right-sheet',
        src: '/__agentos/ext/reports/right-sheet.html',
      },
    ]);
    expect(useShellStore.getState().activeRightSheet).toBeNull();
  });

  test('a registry with ui/right-sheet maps to a right-sheet contribution and meta', () => {
    const registry: RegistryModel = {
      scannedAt: 1,
      extensions: [
        {
          id: 'notes',
          kind: 'customer',
          driven: false,
          toggleable: true,
          rootDir: '/tmp/notes',
          name: 'Notes',
          meta: {
            rightSheet: { label: 'Inbox', icon: 'Bell' },
          },
          ui: { 'right-sheet': '/tmp/notes/ui/right-sheet.tsx' },
          uiEntries: { 'right-sheet': '/__agentos/ext/notes/right-sheet.html' },
          agent: {},
          agentDescriptors: { tools: [], skills: [] },
        },
      ],
    };
    const applied = mapRegistry(registry);
    expect(applied.contributions).toEqual([
      {
        extensionId: 'notes',
        view: 'right-sheet',
        src: '/__agentos/ext/notes/right-sheet.html',
      },
    ]);
    expect(applied.extensions[0]?.rightSheet).toEqual({
      label: 'Inbox',
      icon: 'Bell',
    });
  });
});
