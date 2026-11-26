import { describe, expect, test } from 'bun:test';
import {
  sidebarColumnHasContent,
  sidebarColumnVisible,
  type UiContribution,
} from '@agentos/core/shell/lib';

const crmSidebar: UiContribution = {
  extensionId: 'crm',
  view: 'sidebar',
  src: '/__agentos/ext/crm/sidebar.html',
};

describe('sidebarColumnHasContent', () => {
  test('full-page Shell views have no left sidebar content', () => {
    expect(
      sidebarColumnHasContent({
        activeView: 'extensions',
        sidebars: [crmSidebar],
        hasDashboardSidebar: true,
      }),
    ).toBe(false);
    expect(
      sidebarColumnHasContent({
        activeView: 'hitl',
        sidebars: [],
        hasDashboardSidebar: false,
      }),
    ).toBe(false);
  });

  test('home without dashboardSidebar has no contribution content', () => {
    expect(
      sidebarColumnHasContent({
        activeView: 'home',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(false);
  });

  test('home with dashboardSidebar has content', () => {
    expect(
      sidebarColumnHasContent({
        activeView: 'home',
        sidebars: [],
        hasDashboardSidebar: true,
      }),
    ).toBe(true);
  });

  test('settings always has content (Shell settings nav)', () => {
    expect(
      sidebarColumnHasContent({
        activeView: 'settings',
        sidebars: [],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
  });

  test('extension page has content only when it contributes ui/sidebar', () => {
    expect(
      sidebarColumnHasContent({
        activeView: 'crm',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
    expect(
      sidebarColumnHasContent({
        activeView: 'demo',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(false);
  });
});

describe('sidebarColumnVisible', () => {
  test('requires open state and content', () => {
    expect(
      sidebarColumnVisible({
        sidebarOpen: true,
        activeView: 'crm',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
    expect(
      sidebarColumnVisible({
        sidebarOpen: false,
        activeView: 'crm',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(false);
    expect(
      sidebarColumnVisible({
        sidebarOpen: true,
        activeView: 'extensions',
        sidebars: [],
        hasDashboardSidebar: false,
      }),
    ).toBe(false);
  });
});
