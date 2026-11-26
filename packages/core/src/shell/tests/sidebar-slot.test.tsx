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

describe('SidebarSlot contextual sidebar', () => {
  beforeEach(() => {
    useShellStore.setState({
      activeView: 'home',
      sidebarOpen: true,
      contributions: sidebars,
    });
  });

  test('shows only the active extension sidebar', () => {
    const onCrm = renderToStaticMarkup(
      <SidebarSlot sidebarOpen activeView="crm" contributions={sidebars} />,
    );
    expect(onCrm).toContain('data-extension-id="crm"');
    // Frames are lazy (ticket 145): the inactive sidebar has no iframe yet.
    expect(onCrm).not.toContain('data-extension-id="demo"');
    expect(onCrm).toMatch(
      /data-sidebar-active="true"[\s\S]*data-extension-id="crm"/,
    );
    expect(onCrm).toContain('data-sidebar-active="false"');

    const onDemo = renderToStaticMarkup(
      <SidebarSlot sidebarOpen activeView="demo" contributions={sidebars} />,
    );
    expect(onDemo).toMatch(
      /data-sidebar-active="true"[\s\S]*data-extension-id="demo"/,
    );
    expect(onDemo).not.toContain('data-extension-id="crm"');
  });

  test('home with sidebars present shows no active contribution', () => {
    const html = renderToStaticMarkup(
      <SidebarSlot sidebarOpen activeView="home" contributions={sidebars} />,
    );
    expect(html).toContain('data-slot="sidebar"');
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
      />,
    );
    expect(html).toContain('data-slot="settings-sidebar-host"');
    expect(html).toContain('data-slot="settings-sidebar"');
    expect(html).toContain('data-slot="settings-sidebar-nav"');
  });

  test('full-page Shell views do not mount overlay panels in the left column', () => {
    for (const activeView of ['extensions', 'hitl']) {
      const html = renderToStaticMarkup(
        <SidebarSlot
          sidebarOpen
          activeView={activeView}
          contributions={sidebars}
        />,
      );
      expect(html).not.toContain('data-sidebar-panel');
      expect(html).not.toContain('data-slot="extension-manager-host"');
      expect(html).not.toContain('data-slot="hitl-inbox-host"');
      expect(html).not.toContain('data-slot="extension-manager"');
      expect(html).not.toContain('data-slot="hitl-inbox"');
    }
  });

  test('extension sidebars are not mounted (lazy) on a full-page Shell view', () => {
    const html = renderToStaticMarkup(
      <SidebarSlot
        sidebarOpen
        activeView="extensions"
        contributions={sidebars}
      />,
    );
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('data-sidebar-active="true"');
  });
});
