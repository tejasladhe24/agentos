import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RightSidebarSlot } from '@agentos/core/shell/components';
import {
  rightSidebarColumnHasContent,
  rightSidebarColumnVisible,
  useShellStore,
  type UiContribution,
} from '@agentos/core/shell/lib';

const rightSidebars: UiContribution[] = [
  {
    extensionId: 'files',
    view: 'right-sidebar',
    src: '/__agentos/ext/files/right-sidebar.html',
  },
  {
    extensionId: 'crm',
    view: 'right-sidebar',
    src: '/__agentos/ext/crm/right-sidebar.html',
  },
];

describe('rightSidebarColumnHasContent / rightSidebarColumnVisible', () => {
  test('home and settings have no right sidebar content', () => {
    expect(
      rightSidebarColumnHasContent({
        activeView: 'home',
        rightSidebars,
      }),
    ).toBe(false);
    expect(
      rightSidebarColumnHasContent({
        activeView: 'settings',
        rightSidebars,
      }),
    ).toBe(false);
  });

  test('matches only the active extension contribution', () => {
    expect(
      rightSidebarColumnHasContent({
        activeView: 'files',
        rightSidebars,
      }),
    ).toBe(true);
    expect(
      rightSidebarColumnHasContent({
        activeView: 'demo',
        rightSidebars,
      }),
    ).toBe(false);
  });

  test('rightSidebarColumnVisible requires both open state and content', () => {
    expect(
      rightSidebarColumnVisible({
        rightSidebarOpen: false,
        activeView: 'files',
        rightSidebars,
      }),
    ).toBe(false);
    expect(
      rightSidebarColumnVisible({
        rightSidebarOpen: true,
        activeView: 'files',
        rightSidebars,
      }),
    ).toBe(true);
    expect(
      rightSidebarColumnVisible({
        rightSidebarOpen: true,
        activeView: 'demo',
        rightSidebars,
      }),
    ).toBe(false);
  });
});

describe('RightSidebarSlot', () => {
  beforeEach(() => {
    useShellStore.setState({
      activeView: 'home',
      rightSidebarOpen: false,
      contributions: rightSidebars,
    });
  });

  test('shows only the active extension right-sidebar contribution', () => {
    const onFiles = renderToStaticMarkup(
      <RightSidebarSlot
        rightSidebarOpen
        activeView="files"
        contributions={rightSidebars}
      />,
    );
    expect(onFiles).toContain('data-slot="right-sidebar"');
    expect(onFiles).toContain('data-open="true"');
    expect(onFiles).toMatch(
      /data-right-sidebar-active="true"[\s\S]*data-extension-id="files"/,
    );
    expect(onFiles).toMatch(
      /data-right-sidebar-active="false"[\s\S]*data-extension-id="crm"/,
    );
  });

  test('keeps frames mounted when closed', () => {
    const closed = renderToStaticMarkup(
      <RightSidebarSlot
        rightSidebarOpen={false}
        activeView="files"
        contributions={rightSidebars}
      />,
    );
    expect(closed).toContain('data-slot="right-sidebar"');
    expect(closed).toContain('data-open="false"');
    expect(closed).toContain('data-extension-id="files"');
    expect(closed).toContain('data-visible="false"');
  });
});
