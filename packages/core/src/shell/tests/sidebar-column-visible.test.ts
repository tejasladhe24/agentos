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
  test('shell panels always have content', () => {
    expect(
      sidebarColumnHasContent({
        sidebarPanel: 'extensions',
        activeView: 'home',
        sidebars: [],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
    expect(
      sidebarColumnHasContent({
        sidebarPanel: 'hitl',
        activeView: 'demo',
        sidebars: [],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
  });

  test('home without dashboardSidebar has no contribution content', () => {
    expect(
      sidebarColumnHasContent({
        sidebarPanel: 'contribution',
        activeView: 'home',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(false);
  });

  test('home with dashboardSidebar has content', () => {
    expect(
      sidebarColumnHasContent({
        sidebarPanel: 'contribution',
        activeView: 'home',
        sidebars: [],
        hasDashboardSidebar: true,
      }),
    ).toBe(true);
  });

  test('settings view always has the Shell-hosted settings sidebar', () => {
    expect(
      sidebarColumnHasContent({
        sidebarPanel: 'contribution',
        activeView: 'settings',
        sidebars: [],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
  });

  test('extension without sidebar hides; CRM with sidebar shows', () => {
    expect(
      sidebarColumnHasContent({
        sidebarPanel: 'contribution',
        activeView: 'demo',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(false);
    expect(
      sidebarColumnHasContent({
        sidebarPanel: 'contribution',
        activeView: 'crm',
        sidebars: [crmSidebar],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
  });
});

describe('sidebarColumnVisible', () => {
  test('requires sidebarOpen even when content exists', () => {
    expect(
      sidebarColumnVisible({
        sidebarOpen: false,
        sidebarPanel: 'extensions',
        activeView: 'home',
        sidebars: [crmSidebar],
        hasDashboardSidebar: true,
      }),
    ).toBe(false);
    expect(
      sidebarColumnVisible({
        sidebarOpen: true,
        sidebarPanel: 'extensions',
        activeView: 'home',
        sidebars: [],
        hasDashboardSidebar: false,
      }),
    ).toBe(true);
  });
});
