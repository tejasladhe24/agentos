import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ACTIVITY_BAR_STORAGE_KEY,
  defaultEnabledById,
  readStoredActivity,
  restoreStoredActivity,
  STUB_EXTENSION_CATALOG,
  useShellStore,
  writeStoredActivity,
  type UiContribution,
} from '@agentos/core/shell/lib';

const pageContributions: UiContribution[] = [
  { extensionId: 'crm', view: 'page', src: '/__agentos/ext/crm/page.html' },
  {
    extensionId: 'invoices',
    view: 'page',
    src: '/__agentos/ext/invoices/page.html',
  },
  { extensionId: 'auth', view: 'page', src: '/__agentos/ext/auth/page.html' },
];

const memory = new Map<string, string>();

function installMemoryStorage() {
  memory.clear();
  const storage = {
    getItem(key: string) {
      return memory.has(key) ? memory.get(key)! : null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
    removeItem(key: string) {
      memory.delete(key);
    },
    clear() {
      memory.clear();
    },
    key() {
      return null;
    },
    get length() {
      return memory.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
}

function resetStore() {
  useShellStore.setState({
    activeView: 'home',
    sidebarOpen: true,
    extensions: STUB_EXTENSION_CATALOG,
    enabledById: defaultEnabledById(),
    desiredContributions: pageContributions,
    contributions: pageContributions,
    runtimeStatus: {},
    desiredSkillsByExtension: {},
    skillsByExtension: {},
    statusText: null,
    statusTone: null,
  });
}

describe('activity-bar-persistence', () => {
  beforeEach(() => {
    installMemoryStorage();
    resetStore();
  });

  afterEach(() => {
    memory.clear();
    resetStore();
  });

  test('writeStoredActivity / readStoredActivity round-trip stores only the view', () => {
    writeStoredActivity({ view: 'crm' });
    expect(readStoredActivity()).toEqual({ view: 'crm' });
    expect(memory.get(ACTIVITY_BAR_STORAGE_KEY)).toBe('{"view":"crm"}');
  });

  test('restoreStoredActivity restores last view instead of home', () => {
    writeStoredActivity({ view: 'crm' });
    const restored = restoreStoredActivity();
    expect(restored).toEqual({ view: 'crm' });
    expect(useShellStore.getState().activeView).toBe('crm');
  });

  test('restoreStoredActivity restores the Extensions page', () => {
    writeStoredActivity({ view: 'extensions' });
    restoreStoredActivity();
    expect(useShellStore.getState().activeView).toBe('extensions');
    expect(useShellStore.getState().sidebarOpen).toBe(true);
  });

  test('legacy { view, panel } entries: overlay panels become their page', () => {
    memory.set(
      ACTIVITY_BAR_STORAGE_KEY,
      JSON.stringify({ view: 'home', panel: 'extensions' }),
    );
    expect(readStoredActivity()).toEqual({ view: 'extensions' });

    memory.set(
      ACTIVITY_BAR_STORAGE_KEY,
      JSON.stringify({ view: 'crm', panel: 'hitl' }),
    );
    expect(readStoredActivity()).toEqual({ view: 'hitl' });
  });

  test('legacy { view, panel: contribution } keeps the view', () => {
    memory.set(
      ACTIVITY_BAR_STORAGE_KEY,
      JSON.stringify({ view: 'crm', panel: 'contribution' }),
    );
    restoreStoredActivity();
    expect(useShellStore.getState().activeView).toBe('crm');
  });

  test('readStoredActivity rejects malformed entries', () => {
    memory.set(ACTIVITY_BAR_STORAGE_KEY, '{not json');
    expect(readStoredActivity()).toBeNull();
    memory.set(ACTIVITY_BAR_STORAGE_KEY, JSON.stringify({ panel: 'hitl' }));
    expect(readStoredActivity()).toBeNull();
  });

  test('restoreStoredActivity ignores non-admin Extensions entries', () => {
    useShellStore.setState({ sessionRoles: ['viewer'] });
    writeStoredActivity({ view: 'extensions' });
    restoreStoredActivity();
    expect(useShellStore.getState().activeView).toBe('home');
    useShellStore.setState({ sessionRoles: null });
  });

  test('restoreStoredActivity ignores unknown views', () => {
    writeStoredActivity({ view: 'missing-ext' });
    restoreStoredActivity();
    expect(useShellStore.getState().activeView).toBe('home');
  });

  test('restoreStoredActivity ignores disabled extension views', () => {
    useShellStore.setState({
      enabledById: { ...defaultEnabledById(), crm: false },
      contributions: pageContributions.filter((c) => c.extensionId !== 'crm'),
    });
    writeStoredActivity({ view: 'crm' });
    restoreStoredActivity();
    expect(useShellStore.getState().activeView).toBe('home');
  });
});
