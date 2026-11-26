import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopBar } from '@agentos/core/shell/components';
import { useShellStore } from '@agentos/core/shell/lib';

describe('TopBar', () => {
  beforeEach(() => {
    useShellStore.setState({ sidebarOpen: true });
  });

  test('renders layout slots and branding from virtual config', () => {
    const html = renderToStaticMarkup(<TopBar />);
    expect(html).toContain('data-slot="top-bar"');
    expect(html).toContain('data-slot="top-bar-start"');
    expect(html).toContain('data-slot="top-bar-center"');
    expect(html).toContain('data-slot="top-bar-end"');
    expect(html).toContain('data-slot="topbar-sidebar-toggle"');
    expect(html).not.toContain('data-slot="topbar-settings"');
    expect(html).toContain('data-slot="topbar-app-name"');
    expect(html).toContain('AgentOS');
  });

  test('accepts branding overrides including logo', () => {
    const html = renderToStaticMarkup(
      <TopBar appName="Acme" logoUrl="/_public/logo.svg" />,
    );
    expect(html).toContain('data-slot="topbar-app-name"');
    expect(html).toContain('Acme');
    expect(html).toContain('data-slot="topbar-logo"');
    expect(html).toContain('src="/_public/logo.svg"');
  });

  test('sidebar toggle reflects open state via aria-pressed', () => {
    const open = renderToStaticMarkup(<TopBar sidebarOpen />);
    expect(open).toContain('aria-pressed="true"');
    expect(open).toContain('Collapse sidebar');

    const closed = renderToStaticMarkup(<TopBar sidebarOpen={false} />);
    expect(closed).toContain('aria-pressed="false"');
    expect(closed).toContain('Expand sidebar');
  });

  test('toggleSidebar flips store sidebarOpen', () => {
    expect(useShellStore.getState().sidebarOpen).toBe(true);
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarOpen).toBe(false);
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarOpen).toBe(true);
  });

  test('right sidebar toggle renders only when active view has a right-sidebar contribution', () => {
    const filesRightSidebar = [
      {
        extensionId: 'files',
        view: 'right-sidebar' as const,
        src: '/__agentos/ext/files/right-sidebar.html',
      },
    ];

    const onHome = renderToStaticMarkup(
      <TopBar activeView="home" contributions={filesRightSidebar} />,
    );
    expect(onHome).not.toContain('data-slot="topbar-right-sidebar-toggle"');

    const closed = renderToStaticMarkup(
      <TopBar
        activeView="files"
        rightSidebarOpen={false}
        contributions={filesRightSidebar}
      />,
    );
    expect(closed).toContain('data-slot="topbar-right-sidebar-toggle"');
    expect(closed).toContain('Expand right sidebar');

    const open = renderToStaticMarkup(
      <TopBar
        activeView="files"
        rightSidebarOpen
        contributions={filesRightSidebar}
      />,
    );
    expect(open).toContain('Collapse right sidebar');
  });
});
