import { beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RegistryModel } from '@agentos/core/vite/lib/types';
import { mountShell } from '@agentos/core/shell/mount';
import {
  ACTIVITY_BAR_STORAGE_KEY,
  useShellStore,
} from '@agentos/core/shell/lib';

const fixturesRoot = fileURLToPath(
  new URL('../../vite/tests/fixtures', import.meta.url),
);

const registry: RegistryModel = {
  scannedAt: 99,
  extensions: [
    {
      id: 'crm',
      kind: 'customer',
      driven: false,
      toggleable: true,
      rootDir: join(fixturesRoot, 'extensions/crm'),
      name: 'CRM Helper',
      meta: {},
      ui: { page: join(fixturesRoot, 'extensions/crm/ui/page.tsx') },
      uiEntries: { page: '/__agentos/ext/crm/page.html' },
      agent: {},
      agentDescriptors: { tools: [], skills: ['search-contacts'] },
    },
  ],
};

describe('mountShell registry wiring', () => {
  beforeEach(() => {
    try {
      localStorage?.removeItem(ACTIVITY_BAR_STORAGE_KEY);
    } catch {
      // jsdom / memory storage may be missing
    }
    useShellStore.setState({
      activeView: 'home',
      sidebarOpen: true,
      extensions: [],
      enabledById: {},
      desiredContributions: [],
      contributions: [],
      desiredSkillsByExtension: {},
      skillsByExtension: {},
    });
  });

  test('applies injected registry before render', () => {
    const root = { nodeType: 1 } as unknown as HTMLElement;
    try {
      mountShell(root, { registry });
    } catch {
      // createRoot needs a real DOM; registry apply runs first.
    }

    const state = useShellStore.getState();
    expect(state.extensions).toEqual([
      {
        id: 'crm',
        name: 'CRM Helper',
        kind: 'customer',
        toggleable: true,
        driven: false,
      },
    ]);
    expect(state.contributions).toEqual([
      {
        extensionId: 'crm',
        view: 'page',
        src: '/__agentos/ext/crm/page.html',
      },
    ]);
    expect(state.skillsByExtension.crm).toEqual(['search-contacts']);
  });
});
