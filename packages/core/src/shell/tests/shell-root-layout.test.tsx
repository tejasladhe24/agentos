import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShellRoot } from '@agentos/core/shell/components';
import { useShellStore, type UiContribution } from '@agentos/core/shell/lib';

const pageOnly: UiContribution[] = [
  {
    extensionId: 'crm',
    view: 'page',
    src: '/__agentos/ext/crm/page.html',
  },
];

function render(activeView: string) {
  return renderToStaticMarkup(
    <ShellRoot activeView={activeView} sidebarOpen contributions={pageOnly} />,
  );
}

describe('ShellRoot stable layout', () => {
  beforeEach(() => {
    useShellStore.setState({
      activeView: 'crm',
      sidebarOpen: true,
      contributions: pageOnly,
    });
  });

  test('renders the resizable group even when the sidebar has no content', () => {
    const html = render('crm');
    expect(html).toContain('data-slot="resizable-panel-group"');
    expect(html).toContain('data-slot="resizable-handle"');
    expect(html).toContain('data-slot="main"');
  });

  test('full-page Extensions view mounts inside the same resizable workspace', () => {
    const onExtensions = render('extensions');
    expect(onExtensions).toContain('data-slot="resizable-panel-group"');
    expect(onExtensions).toContain('data-slot="main"');
    expect(onExtensions).toContain('data-slot="extensions-view-host"');
    expect(onExtensions).not.toContain('data-sidebar-panel');
  });

  test('Settings view mounts lazily on first open', () => {
    expect(render('crm')).not.toContain('data-slot="settings-view"');
    const onSettings = renderToStaticMarkup(
      <ShellRoot activeView="settings" sidebarOpen contributions={pageOnly} />,
    );
    expect(onSettings).toContain('data-slot="settings-view"');
    expect(onSettings).toContain('data-slot="main"');
  });
});
