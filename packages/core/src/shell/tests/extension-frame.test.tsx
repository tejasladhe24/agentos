import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ExtensionFrame,
  HomeDashboard,
  MainCanvas,
  ShellRoot,
  SidebarSlot,
} from '@agentos/core/shell/components';
import { contributionKey, useShellStore } from '@agentos/core/shell/lib';

function StubDashboard() {
  return <div data-app-dashboard="true">App home</div>;
}

const crmContributions = [
  {
    extensionId: 'crm',
    view: 'page' as const,
    src: '/__agentos/ext/crm/page.html',
  },
  {
    extensionId: 'crm',
    view: 'sidebar' as const,
    src: '/__agentos/ext/crm/sidebar.html',
  },
  {
    extensionId: 'crm',
    view: 'widget' as const,
    src: '/__agentos/ext/crm/widget.html',
  },
];

describe('ExtensionFrame slot placement', () => {
  test('sandboxed iframe markup includes required attrs', () => {
    useShellStore.setState({ runtimeStatus: {} });
    const html = renderToStaticMarkup(
      createElement(ExtensionFrame, {
        contribution: crmContributions[0]!,
        visible: true,
        theme: 'dark',
      }),
    );
    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-forms"',
    );
    expect(html).toContain('data-extension-id="crm"');
    expect(html).toContain('data-view="page"');
    expect(html).toContain('src="/__agentos/ext/crm/page.html?theme=dark"');
    expect(html).toContain('data-slot="extension-frame-loading"');
    expect(html).toContain('data-loading="true"');
  });

  test('passes light theme into iframe query', () => {
    const html = renderToStaticMarkup(
      createElement(ExtensionFrame, {
        contribution: crmContributions[0]!,
        visible: true,
        theme: 'light',
      }),
    );
    expect(html).toContain('src="/__agentos/ext/crm/page.html?theme=light"');
  });

  test('sandboxed iframes mount into main / sidebar / widgets slots', () => {
    const main = renderToStaticMarkup(
      createElement(MainCanvas, {
        activeView: 'crm',
        contributions: crmContributions,
      }),
    );
    expect(main).toContain('data-slot="main"');
    expect(main).toContain(
      'sandbox="allow-scripts allow-same-origin allow-forms"',
    );
    expect(main).toContain('data-view="page"');

    const sidebar = renderToStaticMarkup(
      createElement(SidebarSlot, {
        sidebarOpen: true,
        activeView: 'crm',
        contributions: crmContributions,
      }),
    );
    expect(sidebar).toContain('data-view="sidebar"');
    expect(sidebar).toContain('data-sidebar-panel="contribution"');
    expect(sidebar).toContain('data-sidebar-active="true"');
    expect(sidebar).toContain(
      'sandbox="allow-scripts allow-same-origin allow-forms"',
    );

    const home = renderToStaticMarkup(
      createElement(HomeDashboard, {
        dashboard: StubDashboard,
        contributions: crmContributions,
      }),
    );
    expect(home).toContain('data-slot="dashboard"');
    expect(home).toContain('data-app-dashboard');
    expect(home).toContain('data-slot="widgets"');
    expect(home).toContain('data-view="widget"');
    expect(home).not.toContain('Widgets slot');
  });

  test('HomeDashboard empty state has no Widgets marketing copy', () => {
    const home = renderToStaticMarkup(
      createElement(HomeDashboard, { contributions: [] }),
    );
    expect(home).toContain('data-slot="dashboard"');
    expect(home).toContain('No dashboard');
    expect(home).not.toContain('data-slot="widgets"');
    expect(home).not.toContain('Widgets slot');
  });

  test('inactive page stays mounted but hidden; crash status is per-contribution', () => {
    const contributions = [
      { extensionId: 'crm', view: 'page' as const, src: '/crm.html' },
      { extensionId: 'invoices', view: 'page' as const, src: '/invoices.html' },
    ];

    useShellStore.setState({
      contributions,
      runtimeStatus: {
        [contributionKey('crm', 'page')]: 'active',
        [contributionKey('invoices', 'page')]: 'crashed',
      },
    });

    const main = renderToStaticMarkup(
      createElement(MainCanvas, {
        activeView: 'crm',
        contributions,
      }),
    );
    expect(main).toContain('data-extension-id="crm"');
    expect(main).toContain('data-extension-id="invoices"');
    expect(main).toContain('src="/crm.html?theme=dark"');
    expect(main).toContain('src="/invoices.html?theme=dark"');
    expect(main).toContain('data-visible="false"');

    expect(useShellStore.getState().contributions).toHaveLength(2);
    expect(
      useShellStore.getState().runtimeStatus[
        contributionKey('invoices', 'page')
      ],
    ).toBe('crashed');
    expect(
      useShellStore.getState().runtimeStatus[contributionKey('crm', 'page')],
    ).toBe('active');
  });

  test('ShellRoot still exposes all slots', () => {
    function HomeSidebar() {
      return <div data-app-dashboard-sidebar />;
    }
    const html = renderToStaticMarkup(
      <ShellRoot
        dashboard={StubDashboard}
        dashboardSidebar={HomeSidebar}
        activeView="home"
        sidebarOpen
        sidebarPanel="contribution"
      />,
    );
    expect(html).toContain('data-slot="sidebar"');
    expect(html).toContain('data-slot="main"');
    expect(html).toContain('data-slot="dashboard"');
    expect(html).toContain('data-app-dashboard');
    expect(html).toContain('data-slot="hidden"');
  });
});
