import { beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RegistryModel } from '@agentos/core/vite/lib/types';
import {
  applyRegistry,
  mapRegistry,
  shellEventBus,
  useShellStore,
} from '@agentos/core/shell/lib';

const fixturesRoot = fileURLToPath(
  new URL('../../vite/tests/fixtures', import.meta.url),
);

function fixtureRegistry(): RegistryModel {
  return {
    scannedAt: 1,
    extensions: [
      {
        id: 'auth',
        kind: 'builtin',
        driven: true,
        toggleable: false,
        rootDir: join(fixturesRoot, 'builtins/auth'),
        name: 'Auth',
        meta: { activityBarSection: 'secondary' },
        ui: { page: join(fixturesRoot, 'builtins/auth/ui/page.tsx') },
        uiEntries: { page: '/__agentos/ext/auth/page.html' },
        agent: {},
        agentDescriptors: { tools: [], skills: [] },
      },
      {
        id: 'crm',
        kind: 'customer',
        driven: false,
        toggleable: true,
        rootDir: join(fixturesRoot, 'extensions/crm'),
        name: 'CRM Helper',
        meta: { icon: 'Users', activityBarSection: 'secondary' },
        ui: {
          page: join(fixturesRoot, 'extensions/crm/ui/page.tsx'),
          sidebar: join(fixturesRoot, 'extensions/crm/ui/sidebar.tsx'),
        },
        uiEntries: {
          page: '/__agentos/ext/crm/page.html',
          sidebar: '/__agentos/ext/crm/sidebar.html',
        },
        agent: {
          tools: join(fixturesRoot, 'extensions/crm/agent/tools.json'),
          skills: join(fixturesRoot, 'extensions/crm/agent/skills.ts'),
        },
        agentDescriptors: {
          tools: [{ name: 'search_contacts' }],
          skills: ['search-contacts'],
        },
      },
    ],
  };
}

describe('applyRegistry', () => {
  beforeEach(() => {
    useShellStore.setState({
      activeView: 'home',
      sidebarOpen: true,
      extensions: [],
      enabledById: {},
      desiredContributions: [],
      contributions: [],
      runtimeStatus: {},
      desiredSkillsByExtension: {},
      skillsByExtension: {},
      statusText: null,
      statusTone: null,
    });
  });

  test('mapRegistry builds catalog, contributions, and skills', () => {
    const mapped = mapRegistry(fixtureRegistry());
    expect(mapped.extensions).toEqual([
      {
        id: 'auth',
        name: 'Auth',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        activityBarSection: 'secondary',
      },
      {
        id: 'crm',
        name: 'CRM Helper',
        kind: 'customer',
        toggleable: true,
        driven: false,
        icon: 'Users',
      },
    ]);
    expect(mapped.contributions).toEqual([
      {
        extensionId: 'auth',
        view: 'page',
        src: '/__agentos/ext/auth/page.html',
      },
      {
        extensionId: 'crm',
        view: 'page',
        src: '/__agentos/ext/crm/page.html',
      },
      {
        extensionId: 'crm',
        view: 'sidebar',
        src: '/__agentos/ext/crm/sidebar.html',
      },
    ]);
    expect(mapped.skillsByExtension).toEqual({
      crm: ['search-contacts'],
    });
  });

  test('applyRegistry seeds the shell store', () => {
    applyRegistry(fixtureRegistry());
    const state = useShellStore.getState();
    expect(state.extensions.map((e) => e.id)).toEqual(['auth', 'crm']);
    expect(state.enabledById.auth).toBe(true);
    expect(state.enabledById.crm).toBe(true);
    expect(state.contributions).toHaveLength(3);
    expect(state.skillsByExtension.crm).toEqual(['search-contacts']);
    expect(state.desiredSkillsByExtension.crm).toEqual(['search-contacts']);
  });

  test('coerces customer activityBarSection secondary to primary', () => {
    const mapped = mapRegistry(fixtureRegistry());
    const auth = mapped.extensions.find((e) => e.id === 'auth');
    const crm = mapped.extensions.find((e) => e.id === 'crm');
    expect(auth?.activityBarSection).toBe('secondary');
    expect(crm?.activityBarSection).toBeUndefined();
  });

  test('defaults auth to secondary when meta omits activityBarSection', () => {
    const registry = fixtureRegistry();
    const authExt = registry.extensions.find((e) => e.id === 'auth');
    if (authExt) authExt.meta = {};
    const mapped = mapRegistry(registry);
    expect(
      mapped.extensions.find((e) => e.id === 'auth')?.activityBarSection,
    ).toBe('secondary');
  });
});

describe('mapRegistry event declarations', () => {
  test('carries meta.events into the extension entry and the Shell bus', () => {
    const registry = fixtureRegistry();
    registry.extensions[1]!.meta = {
      events: {
        publishes: ['crm.contact.selected'],
        subscribes: ['email.received'],
      },
    };

    const mapped = mapRegistry(registry);
    expect(mapped.extensions.find((e) => e.id === 'crm')?.events).toEqual({
      publishes: ['crm.contact.selected'],
      subscribes: ['email.received'],
    });
    expect(
      mapped.extensions.find((e) => e.id === 'auth')?.events,
    ).toBeUndefined();

    // The singleton bus reads declarations from the seeded store.
    applyRegistry(registry);
    expect(() =>
      shellEventBus.assertCanPublish('crm', 'crm.contact.selected'),
    ).not.toThrow();
    expect(() => shellEventBus.assertCanPublish('crm', 'crm.other')).toThrow(
      /not declared/,
    );
    expect(() => shellEventBus.assertCanPublish('auth', 'auth.x')).toThrow(
      /not declared/,
    );
  });
});
