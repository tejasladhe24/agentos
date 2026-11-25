import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ActivityBar,
  ExtensionManagerList,
} from '@agentos/core/shell/components';
import {
  defaultEnabledById,
  defaultSkillsByExtension,
  STUB_EXTENSION_CATALOG,
  useShellStore,
} from '@agentos/core/shell/lib';

function resetStore() {
  useShellStore.setState({
    activeView: 'home',
    sidebarOpen: true,
    sidebarPanel: 'contribution',
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

const originalFetch = globalThis.fetch;

describe('ExtensionManagerDrawer', () => {
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

  test('list hides builtins by default and shows customers', () => {
    const html = renderToStaticMarkup(
      <ExtensionManagerList
        extensions={STUB_EXTENSION_CATALOG}
        enabledById={defaultEnabledById()}
      />,
    );

    expect(html).toContain('data-slot="extension-manager-list"');
    expect(html).toContain('data-slot="extension-manager-filter"');
    expect(html).toContain('data-show-builtin="false"');
    expect(html).toContain('aria-label="Filter extensions"');
    expect(html).not.toContain('data-extension-id="auth"');
    expect(html).not.toContain('data-kind="builtin"');
    expect(html).toContain('data-extension-id="crm"');
    expect(html).toContain('data-kind="customer"');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('Disable CRM');
  });

  test('disabled customer shows disabled status', () => {
    const html = renderToStaticMarkup(
      <ExtensionManagerList
        extensions={STUB_EXTENSION_CATALOG}
        enabledById={{ ...defaultEnabledById(), crm: false }}
      />,
    );
    expect(html).toContain('data-extension-id="crm"');
    expect(html).toContain('data-status="disabled"');
    expect(html).toContain('Enable CRM');
  });

  test('ActivityBar Extensions control opens sidebar panel without changing view', () => {
    const html = renderToStaticMarkup(<ActivityBar />);
    expect(html).toContain('aria-label="Extensions"');

    useShellStore.getState().setSidebarPanel('extensions');
    expect(useShellStore.getState().sidebarPanel).toBe('extensions');
    expect(useShellStore.getState().activeView).toBe('home');
  });

  test('manager row exposes data-icon from meta (Cube fallback)', () => {
    const withIcon = renderToStaticMarkup(
      <ExtensionManagerList
        extensions={[
          {
            id: 'crm',
            name: 'CRM',
            kind: 'customer',
            toggleable: true,
            driven: false,
            icon: 'Users',
          },
        ]}
        enabledById={{ crm: true }}
      />,
    );
    expect(withIcon).toContain('data-icon="Users"');

    const fallback = renderToStaticMarkup(
      <ExtensionManagerList
        extensions={[
          {
            id: 'crm',
            name: 'CRM',
            kind: 'customer',
            toggleable: true,
            driven: false,
          },
        ]}
        enabledById={{ crm: true }}
      />,
    );
    expect(fallback).toContain('data-icon="Cube"');
  });
});
