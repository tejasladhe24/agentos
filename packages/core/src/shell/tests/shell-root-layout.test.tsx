import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShellRoot } from '@agentos/core/shell/components';
import {
  useShellStore,
  type SidebarPanel,
  type UiContribution,
} from '@agentos/core/shell/lib';

const pageOnly: UiContribution[] = [
  {
    extensionId: 'crm',
    view: 'page',
    src: '/__agentos/ext/crm/page.html',
  },
];

function render(sidebarPanel: SidebarPanel) {
  return renderToStaticMarkup(
    <ShellRoot
      activeView="crm"
      sidebarOpen
      sidebarPanel={sidebarPanel}
      contributions={pageOnly}
    />,
  );
}

/** Markup from the main canvas slot onward (strip sidebar differences). */
function mainSlice(html: string): string {
  const start = html.indexOf('data-slot="main"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
}

describe('ShellRoot stable layout', () => {
  beforeEach(() => {
    useShellStore.setState({
      activeView: 'crm',
      sidebarOpen: true,
      sidebarPanel: 'contribution',
      contributions: pageOnly,
    });
  });

  test('renders the resizable group even when the sidebar has no content', () => {
    const html = render('contribution');
    expect(html).toContain('data-slot="resizable-panel-group"');
    expect(html).toContain('data-slot="resizable-handle"');
    expect(html).toContain('data-slot="main"');
  });

  test('opening a Shell panel keeps the same layout tree around the main canvas', () => {
    const empty = render('contribution');
    const withPanel = render('extensions');
    expect(withPanel).toContain('data-slot="resizable-panel-group"');
    expect(withPanel).toContain('data-slot="extension-manager-host"');
    expect(mainSlice(withPanel)).toBe(mainSlice(empty));
  });

  test('Settings view mounts lazily on first open', () => {
    expect(render('contribution')).not.toContain('data-slot="settings-view"');
    const onSettings = renderToStaticMarkup(
      <ShellRoot activeView="settings" sidebarOpen contributions={pageOnly} />,
    );
    expect(onSettings).toContain('data-slot="settings-view"');
    expect(onSettings).toContain('data-slot="main"');
  });
});
