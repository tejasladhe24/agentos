import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityBar } from '../components/chrome/activity-bar';
import { buildActivityBarSections } from '../lib/chrome/build-activity-bar-items';
import type { ExtensionEntry } from '../lib/chrome/extension-catalog';
import { isAdminRoles, useShellStore } from '../lib/chrome/store';
import type { UiContribution } from '../lib/ui-contribs/contribution';

const catalog: ExtensionEntry[] = [
  {
    id: 'auth',
    name: 'Auth',
    kind: 'builtin',
    toggleable: false,
    driven: true,
    activityBarSection: 'secondary',
  },
  {
    id: 'hitl',
    name: 'Approvals',
    kind: 'builtin',
    toggleable: false,
    driven: true,
    activityBarSection: 'secondary',
    icon: 'HandWaving',
  },
  {
    id: 'demo',
    name: 'Demo',
    kind: 'customer',
    toggleable: true,
    driven: false,
  },
];

const contributions: UiContribution[] = [
  {
    extensionId: 'auth',
    view: 'page',
    src: '/__agentos/ext/auth/page.html',
  },
  {
    extensionId: 'hitl',
    view: 'page',
    src: '/__agentos/ext/hitl/page.html',
  },
  {
    extensionId: 'demo',
    view: 'page',
    src: '/__agentos/ext/demo/page.html',
  },
];

describe('buildActivityBarSections', () => {
  test('puts customer pages in primary and auth/Approvals pages in secondary', () => {
    const { primary, secondary } = buildActivityBarSections({
      extensions: catalog,
      enabledById: { auth: true, hitl: true, demo: true },
      contributions,
    });

    expect(primary.map((i) => i.id)).toEqual(['home', 'demo']);
    // flex-col-reverse: Approvals last in array → top of secondary cluster.
    expect(secondary.map((i) => i.id)).toEqual(['extensions', 'auth', 'hitl']);
    expect(secondary.find((i) => i.id === 'hitl')?.label).toBe('Approvals');
    expect(secondary.find((i) => i.id === 'extensions')?.label).toBe(
      'Extensions',
    );
  });

  test('Approvals is a page item: no overlay chrome, activates like any view', () => {
    const { secondary } = buildActivityBarSections({
      extensions: catalog,
      enabledById: { auth: true, hitl: true, demo: true },
      contributions,
    });
    const approvals = secondary.find((i) => i.id === 'hitl');
    expect(approvals).toBeDefined();
    expect('panel' in (approvals ?? {})).toBe(false);
  });

  test('Approvals is hidden when its page is not contributed', () => {
    const { secondary } = buildActivityBarSections({
      extensions: catalog,
      enabledById: { auth: true, hitl: true, demo: true },
      contributions: contributions.filter((c) => c.extensionId !== 'hitl'),
    });
    expect(secondary.map((i) => i.id)).not.toContain('hitl');
  });

  test('omits disabled customer pages from primary', () => {
    const { primary } = buildActivityBarSections({
      extensions: catalog,
      enabledById: { auth: true, hitl: true, demo: false },
      contributions,
    });
    expect(primary.map((i) => i.id)).toEqual(['home']);
  });

  test('defaults builtin auth/hitl to secondary when section field is missing', () => {
    const withoutSection: ExtensionEntry[] = [
      {
        id: 'auth',
        name: 'Auth',
        kind: 'builtin',
        toggleable: false,
        driven: true,
      },
      {
        id: 'hitl',
        name: 'HITL',
        kind: 'builtin',
        toggleable: false,
        driven: true,
      },
      {
        id: 'demo',
        name: 'Demo',
        kind: 'customer',
        toggleable: true,
        driven: false,
      },
    ];
    const { primary, secondary } = buildActivityBarSections({
      extensions: withoutSection,
      enabledById: { auth: true, hitl: true, demo: true },
      contributions,
    });
    expect(primary.map((i) => i.id)).toEqual(['home', 'demo']);
    expect(secondary.map((i) => i.id)).toEqual(['extensions', 'auth', 'hitl']);
  });

  test('non-admin sees tenant-scoped secondary items but not secrets or extensions', () => {
    const fullCatalog: ExtensionEntry[] = [
      {
        id: 'hitl',
        name: 'Approvals',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        activityBarSection: 'secondary',
      },
      {
        id: 'inbound-email',
        name: 'Email',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        activityBarSection: 'secondary',
      },
      {
        id: 'files',
        name: 'Files',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        activityBarSection: 'secondary',
      },
      {
        id: 'audit',
        name: 'Activity',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        activityBarSection: 'secondary',
      },
      {
        id: 'secrets',
        name: 'Secrets',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        activityBarSection: 'secondary',
      },
      {
        id: 'settings',
        name: 'Settings',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        activityBarSection: 'secondary',
      },
    ];
    const fullContribs: UiContribution[] = [
      { extensionId: 'hitl', view: 'page', src: '/hitl' },
      { extensionId: 'inbound-email', view: 'page', src: '/email' },
      { extensionId: 'files', view: 'page', src: '/files' },
      { extensionId: 'audit', view: 'page', src: '/audit' },
      { extensionId: 'secrets', view: 'page', src: '/secrets' },
    ];
    const enabledById = {
      hitl: true,
      'inbound-email': true,
      files: true,
      audit: true,
      secrets: true,
      settings: true,
    };

    const nonAdmin = buildActivityBarSections({
      extensions: fullCatalog,
      enabledById,
      contributions: fullContribs,
      isAdmin: false,
    });
    // Builtin pages keep catalog order; Approvals is a normal page item now.
    expect(nonAdmin.secondary.map((i) => i.id)).toEqual([
      'hitl',
      'inbound-email',
      'files',
      'audit',
      'settings',
    ]);
    expect(nonAdmin.secondary.some((i) => i.id === 'secrets')).toBe(false);
    expect(nonAdmin.secondary.some((i) => i.id === 'extensions')).toBe(false);

    const admin = buildActivityBarSections({
      extensions: fullCatalog,
      enabledById,
      contributions: fullContribs,
      isAdmin: true,
    });
    expect(admin.secondary.map((i) => i.id)).toEqual([
      'extensions',
      'hitl',
      'inbound-email',
      'files',
      'audit',
      'secrets',
      'settings',
    ]);
  });

  test('isAdminRoles and setSessionRoles guard admin views for non-admins', () => {
    expect(isAdminRoles(['admin'])).toBe(true);
    expect(isAdminRoles(['owner'])).toBe(true);
    expect(isAdminRoles(['viewer'])).toBe(false);
    expect(isAdminRoles(['reviewer'])).toBe(false);
    expect(isAdminRoles(null)).toBe(true);

    useShellStore.setState({
      activeView: 'secrets',
    });
    useShellStore.getState().setSessionRoles(['viewer']);
    expect(useShellStore.getState().activeView).toBe('home');
    useShellStore.getState().setSessionRoles(null);
  });
});

describe('ActivityBar layout regions', () => {
  test('renders distinct primary and secondary regions', () => {
    const html = renderToStaticMarkup(<ActivityBar />);
    expect(html).toContain('data-slot="activity-bar-primary"');
    expect(html).toContain('data-slot="activity-bar-secondary"');
    expect(html).toContain('aria-label="Home"');
    expect(html).toContain('aria-label="Extensions"');
  });
});
