import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarSlot } from '@agentos/core/shell/components';
import { useShellStore, type UiContribution } from '@agentos/core/shell/lib';

const sidebars: UiContribution[] = [
  {
    extensionId: 'crm',
    view: 'sidebar',
    src: '/__agentos/ext/crm/sidebar.html',
  },
  {
    extensionId: 'demo',
    view: 'sidebar',
    src: '/__agentos/ext/demo/sidebar.html',
  },
];

describe('SidebarSlot contextual + shell panels', () => {
  beforeEach(() => {
    useShellStore.setState({
      activeView: 'home',
      sidebarOpen: true,
      sidebarPanel: 'contribution',
      contributions: sidebars,
    });
  });

  test('shows only the active extension sidebar in contribution mode', () => {
    const onCrm = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="crm"
        contributions={sidebars}
        sidebarPanel="contribution"
      />,
    );
    expect(onCrm).toContain('data-sidebar-panel="contribution"');
    expect(onCrm).toContain('data-extension-id="crm"');
    expect(onCrm).toContain('data-extension-id="demo"');
    expect(onCrm).toMatch(
      /data-sidebar-active="true"[\s\S]*data-extension-id="crm"/,
    );
    expect(onCrm).toMatch(
      /data-sidebar-active="false"[\s\S]*data-extension-id="demo"/,
    );

    const onDemo = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="demo"
        contributions={sidebars}
        sidebarPanel="contribution"
      />,
    );
    expect(onDemo).toMatch(
      /data-sidebar-active="true"[\s\S]*data-extension-id="demo"/,
    );
    expect(onDemo).toMatch(
      /data-sidebar-active="false"[\s\S]*data-extension-id="crm"/,
    );
  });

  test('home with sidebars present shows no active contribution', () => {
    const html = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="home"
        contributions={sidebars}
        sidebarPanel="contribution"
      />,
    );
    expect(html).toContain('data-sidebar-panel="contribution"');
    expect(html).not.toContain('data-sidebar-active="true"');
  });

  test('home renders in-process dashboardSidebar when provided', () => {
    function HomeSidebar() {
      return <div data-app-dashboard-sidebar>Home nav</div>;
    }
    const html = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="home"
        contributions={sidebars}
        sidebarPanel="contribution"
        dashboardSidebar={HomeSidebar}
      />,
    );
    expect(html).toContain('data-slot="dashboard-sidebar"');
    expect(html).toContain('data-app-dashboard-sidebar');
    expect(html).toContain('Home nav');
    expect(html).toContain('data-sidebar-active="true"');
    expect(html).toContain('data-sidebar-active="false"');
  });

  test('settings view renders the Shell-hosted settings navigation', () => {
    const html = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="settings"
        contributions={sidebars}
        sidebarPanel="contribution"
      />,
    );
    expect(html).toContain('data-slot="settings-sidebar-host"');
    expect(html).toContain('data-slot="settings-sidebar"');
    expect(html).toContain('data-slot="settings-sidebar-nav"');
  });

  test('extensions panel renders Extension Manager inside sidebar (no sheet)', () => {
    const html = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="home"
        contributions={sidebars}
        sidebarPanel="extensions"
      />,
    );
    expect(html).toContain('data-sidebar-panel="extensions"');
    expect(html).toContain('data-slot="extension-manager"');
    expect(html).toContain('Extensions');
    expect(html).not.toContain('data-sidebar-active="true"');
    expect(html).not.toContain('role="dialog"');
  });

  test('hitl panel renders Approvals inside sidebar (no sheet)', () => {
    const html = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="home"
        contributions={sidebars}
        sidebarPanel="hitl"
      />,
    );
    expect(html).toContain('data-sidebar-panel="hitl"');
    expect(html).toContain('data-slot="hitl-inbox"');
    expect(html).toContain('data-slot="hitl-inbox-loading"');
    expect(html).toContain('data-loading="true"');
    expect(html).not.toContain('No pending approvals.');
    expect(html).not.toContain('data-sidebar-active="true"');
    expect(html).not.toContain('role="dialog"');
  });

  test('extension sidebars stay mounted (hidden) while a Shell panel is open', () => {
    const html = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="crm"
        contributions={sidebars}
        sidebarPanel="extensions"
      />,
    );
    expect(html).toContain('data-slot="extension-manager-host"');
    expect(html).toContain('data-extension-id="crm"');
    expect(html).toContain('data-extension-id="demo"');
    expect(html).not.toContain('data-slot="hitl-inbox-host"');
  });
});
