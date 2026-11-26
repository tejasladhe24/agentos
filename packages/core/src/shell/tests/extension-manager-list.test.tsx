import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ActivityBar,
  ExtensionManagerList,
  ExtensionManagerView,
} from '@agentos/core/shell/components';
import { defaultEnabledById, useShellStore } from '@agentos/core/shell/lib';
import {
  STUB_EXTENSION_CATALOG,
  defaultSkillsByExtension,
} from './fixtures/stub-extension-catalog';

function resetStore() {
  useShellStore.setState({
    activeView: 'home',
    sidebarOpen: true,
    extensions: STUB_EXTENSION_CATALOG,
    enabledById: defaultEnabledById(STUB_EXTENSION_CATALOG),
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

describe('ExtensionManagerList', () => {
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
        enabledById={defaultEnabledById(STUB_EXTENSION_CATALOG)}
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
        enabledById={{
          ...defaultEnabledById(STUB_EXTENSION_CATALOG),
          crm: false,
        }}
      />,
    );
    expect(html).toContain('data-extension-id="crm"');
    expect(html).toContain('data-status="disabled"');
    expect(html).toContain('Enable CRM');
  });

  test('ActivityBar Extensions control is a page item (no sidebar overlay)', () => {
    const html = renderToStaticMarkup(<ActivityBar />);
    expect(html).toContain('aria-label="Extensions"');
    expect(html).not.toContain('data-sidebar-panel');

    useShellStore.getState().setActiveView('extensions');
    expect(useShellStore.getState().activeView).toBe('extensions');
  });

  test('list renders as a table with status and enable controls', () => {
    const html = renderToStaticMarkup(
      <ExtensionManagerList
        extensions={STUB_EXTENSION_CATALOG}
        enabledById={defaultEnabledById(STUB_EXTENSION_CATALOG)}
      />,
    );
    expect(html).toContain('aria-label="Extension list"');
    expect(html).toContain('data-slot="extension-manager-list"');
    expect(html).toContain('data-slot="extension-manager-filter"');
    expect(html).toContain('>Status<');
    expect(html).toContain('Enabled');
  });

  test('builtins are hidden by default in the list', () => {
    const html = renderToStaticMarkup(
      <ExtensionManagerList
        extensions={STUB_EXTENSION_CATALOG}
        enabledById={defaultEnabledById(STUB_EXTENSION_CATALOG)}
      />,
    );
    expect(html).not.toContain('data-extension-id="auth"');
  });

  test('full-page manager view renders a heading and the list', () => {
    const html = renderToStaticMarkup(<ExtensionManagerView />);
    expect(html).toContain('data-slot="extension-manager-view"');
    expect(html).toContain('<h1');
    expect(html).toContain('Extensions');
    expect(html).toContain('data-slot="extension-manager-list"');
    expect(html).not.toContain('data-sidebar-panel');
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
