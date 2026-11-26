import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShellRoot } from '@agentos/core/shell/components';
import type { UiContribution } from '@agentos/core/shell/lib';

const crmSidebar: UiContribution = {
  extensionId: 'crm',
  view: 'sidebar',
  src: '/__agentos/ext/crm/sidebar.html',
};

function HomeSidebar() {
  return <div data-app-dashboard-sidebar />;
}

describe('mountShell / ShellRoot', () => {
  test('renders workspace with required slots', () => {
    const html = renderToStaticMarkup(<ShellRoot />);

    expect(html).toContain('data-agentos-shell');
    expect(html).toContain('data-slot="main"');
    expect(html).toContain('data-slot="dashboard"');
    expect(html).toContain('data-slot="hidden"');
    expect(html).toContain('data-slot="top-bar"');
    expect(html).toContain('data-slot="status-bar"');
    expect(html).toContain('Command Palette');
  });

  test('home without dashboardSidebar collapses empty sidebar column', () => {
    const html = renderToStaticMarkup(
      <ShellRoot
        activeView="home"
        sidebarOpen
        sidebarPanel="contribution"
        contributions={[crmSidebar]}
      />,
    );
    expect(html).toContain('data-slot="resizable-panel-group"');
    expect(html).toContain('data-sidebar-expanded="false"');
    expect(html).toContain('data-slot="dashboard"');
  });

  test('home with dashboardSidebar shows sidebar column', () => {
    const html = renderToStaticMarkup(
      <ShellRoot
        activeView="home"
        sidebarOpen
        sidebarPanel="contribution"
        dashboardSidebar={HomeSidebar}
      />,
    );
    expect(html).toContain('data-slot="sidebar"');
    expect(html).toContain('data-slot="dashboard-sidebar"');
    expect(html).toContain('data-app-dashboard-sidebar');
  });

  test('extension without sidebar collapses column; CRM with sidebar expands it', () => {
    const demoHtml = renderToStaticMarkup(
      <ShellRoot
        activeView="demo"
        sidebarOpen
        sidebarPanel="contribution"
        contributions={[crmSidebar]}
      />,
    );
    expect(demoHtml).toContain('data-sidebar-expanded="false"');

    const crmHtml = renderToStaticMarkup(
      <ShellRoot
        activeView="crm"
        sidebarOpen
        sidebarPanel="contribution"
        contributions={[crmSidebar]}
      />,
    );
    expect(crmHtml).toContain('data-sidebar-expanded="true"');
    expect(crmHtml).toContain('data-extension-id="crm"');
  });

  test('extensions panel still allocates sidebar column', () => {
    const html = renderToStaticMarkup(
      <ShellRoot
        activeView="home"
        sidebarOpen
        sidebarPanel="extensions"
        contributions={[]}
      />,
    );
    expect(html).toContain('data-slot="sidebar"');
    expect(html).toContain('data-sidebar-panel="extensions"');
  });

  test('closing sidebar keeps column + main mounted (no layout tear-down)', () => {
    const open = renderToStaticMarkup(
      <ShellRoot
        activeView="crm"
        sidebarOpen
        sidebarPanel="contribution"
        contributions={[crmSidebar]}
      />,
    );
    expect(open).toContain('data-slot="sidebar"');
    expect(open).toContain('data-slot="main"');
    expect(open).toContain('data-open="true"');

    const closed = renderToStaticMarkup(
      <ShellRoot
        activeView="crm"
        sidebarOpen={false}
        sidebarPanel="contribution"
        contributions={[crmSidebar]}
      />,
    );
    // Same hosts stay in the tree so extension pages/sidebars are not remounted.
    expect(closed).toContain('data-slot="sidebar"');
    expect(closed).toContain('data-slot="main"');
    expect(closed).toContain('data-open="false"');
    expect(closed).toContain('data-slot="resizable-panel-group"');
  });

  test('non-home view keeps main slot active', () => {
    const html = renderToStaticMarkup(<ShellRoot activeView="crm" />);
    expect(html).toContain('data-slot="main"');
    expect(html).toMatch(/data-active="true"[^>]*>[\s\S]*data-slot="main"/);
  });

  test('right sidebar expands only when open and active view contributes right-sidebar', () => {
    const filesRightSidebar: UiContribution = {
      extensionId: 'files',
      view: 'right-sidebar',
      src: '/__agentos/ext/files/right-sidebar.html',
    };

    const closed = renderToStaticMarkup(
      <ShellRoot
        activeView="files"
        rightSidebarOpen={false}
        contributions={[filesRightSidebar]}
      />,
    );
    expect(closed).toContain('data-right-sidebar-expanded="false"');
    expect(closed).toContain('data-slot="right-sidebar"');

    const open = renderToStaticMarkup(
      <ShellRoot
        activeView="files"
        rightSidebarOpen
        contributions={[filesRightSidebar]}
      />,
    );
    expect(open).toContain('data-right-sidebar-expanded="true"');
    expect(open).toContain('data-extension-id="files"');

    const otherView = renderToStaticMarkup(
      <ShellRoot
        activeView="crm"
        rightSidebarOpen
        contributions={[filesRightSidebar]}
      />,
    );
    expect(otherView).toContain('data-right-sidebar-expanded="false"');
  });
});
