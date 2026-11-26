import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { SettingsSidebar } from '../components/settings/settings-sidebar';
import { SettingsView } from '../components/settings/settings-view';
import {
  buildSettingsItems,
  filterSettingsItems,
  groupSettingsItems,
  searchSettings,
  type ExtensionEntry,
  type UiContribution,
} from '../lib';

const extensions: ExtensionEntry[] = [
  {
    id: 'auth',
    name: 'Auth',
    kind: 'builtin',
    toggleable: false,
    driven: true,
    settings: [
      {
        id: 'profile',
        label: 'Profile',
        description: 'Manage your identity.',
        icon: 'User',
        group: 'Account',
        keywords: ['email'],
        entries: [
          {
            id: 'display-name',
            label: 'Display name',
            hint: 'full name shown to teammates rename',
          },
        ],
      },
      {
        id: 'security',
        label: 'Security',
        description: 'Change your password.',
        icon: 'Lock',
        group: 'Account',
        keywords: ['password'],
        entries: [
          {
            id: 'change-password',
            label: 'Change password',
            hint: 'update current new credentials secret pwd',
          },
          {
            id: 'log-out',
            label: 'Sign out',
            hint: 'log out logout end session',
          },
        ],
      },
    ],
  },
  {
    id: 'files',
    name: 'Files',
    kind: 'builtin',
    toggleable: false,
    driven: true,
    icon: 'Folder',
    settings: [
      {
        id: 'files',
        label: 'Files',
        description: 'Configure bin retention.',
        icon: 'Folder',
        group: 'Workspace',
      },
    ],
  },
  {
    id: 'crm',
    name: 'CRM',
    kind: 'customer',
    toggleable: true,
    driven: false,
    icon: 'Users',
  },
];

const contributions: UiContribution[] = [
  {
    extensionId: 'auth',
    view: 'settings',
    src: '/__agentos/ext/auth/settings.html',
  },
  {
    extensionId: 'files',
    view: 'settings',
    src: '/__agentos/ext/files/settings.html',
  },
  {
    extensionId: 'crm',
    view: 'settings',
    src: '/__agentos/ext/crm/settings.html',
  },
];

describe('buildSettingsItems', () => {
  test('derives items from enabled settings contributions and supports convention fallback', () => {
    const items = buildSettingsItems({ extensions, contributions });
    expect(items.map((i) => i.key)).toEqual([
      'auth:profile',
      'auth:security',
      'files:files',
      'crm:crm',
    ]);
    expect(items.find((i) => i.key === 'crm:crm')?.group).toBe('Extensions');
    expect(items.find((i) => i.key === 'crm:crm')?.label).toBe('CRM');
  });

  test('omits extensions whose settings contribution is disabled/absent', () => {
    const onlyFiles = contributions.filter((c) => c.extensionId === 'files');
    const items = buildSettingsItems({ extensions, contributions: onlyFiles });
    expect(items.map((i) => i.key)).toEqual(['files:files']);
  });

  test('hides adminOnly sections and entries from non-admins', () => {
    const gated: ExtensionEntry[] = [
      {
        id: 'ai',
        name: 'AI',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        settings: [
          { id: 'ai', label: 'AI', group: 'Workspace', adminOnly: true },
        ],
      },
      {
        id: 'notifications',
        name: 'Notifications',
        kind: 'builtin',
        toggleable: false,
        driven: true,
        settings: [
          {
            id: 'sms',
            label: 'SMS',
            group: 'Integrations',
            entries: [
              { id: 'sms-from', label: 'Your sender number' },
              { id: 'sms-provider', label: 'SMS provider', adminOnly: true },
            ],
          },
        ],
      },
    ];
    const gatedContributions: UiContribution[] = [
      { extensionId: 'ai', view: 'settings', src: '/__agentos/ext/ai/s.html' },
      {
        extensionId: 'notifications',
        view: 'settings',
        src: '/__agentos/ext/notifications/s.html',
      },
    ];

    const admin = buildSettingsItems({
      extensions: gated,
      contributions: gatedContributions,
      isAdmin: true,
    });
    expect(admin.map((i) => i.key)).toEqual(['ai:ai', 'notifications:sms']);
    expect(admin[1]?.entries.map((e) => e.id)).toEqual([
      'sms-from',
      'sms-provider',
    ]);

    const member = buildSettingsItems({
      extensions: gated,
      contributions: gatedContributions,
      isAdmin: false,
    });
    expect(member.map((i) => i.key)).toEqual(['notifications:sms']);
    expect(member[0]?.entries.map((e) => e.id)).toEqual(['sms-from']);
    expect(
      searchSettings(member, 'SMS provider').some(
        (r) => r.entry?.id === 'sms-provider',
      ),
    ).toBe(false);
  });

  test('filters and groups items cleanly', () => {
    const items = buildSettingsItems({ extensions, contributions });
    const filtered = filterSettingsItems(items, 'password');
    expect(filtered.map((i) => i.key)).toEqual(['auth:security']);

    const groups = groupSettingsItems(items);
    expect(groups.map((g) => g.group)).toEqual([
      'Account',
      'Workspace',
      'Extensions',
    ]);
  });
});

describe('searchSettings (fuzzy, entry-level)', () => {
  const items = buildSettingsItems({ extensions, contributions });

  test('finds an individual setting by its plain-text hint', () => {
    const results = searchSettings(items, 'teammates');
    expect(results[0]?.entry?.id).toBe('display-name');
    expect(results[0]?.item.key).toBe('auth:profile');
  });

  test('tolerates abbreviations and typos', () => {
    expect(searchSettings(items, 'pwd')[0]?.entry?.id).toBe('change-password');
    expect(searchSettings(items, 'pasword')[0]?.entry?.id).toBe(
      'change-password',
    );
    expect(searchSettings(items, 'logut')[0]?.entry?.id).toBe('log-out');
  });

  test('requires every query token to match', () => {
    expect(searchSettings(items, 'password zebra')).toEqual([]);
    expect(searchSettings(items, '')).toEqual([]);
  });

  test('ranks the section above weaker matches for its own name', () => {
    const results = searchSettings(items, 'files');
    expect(results[0]?.item.key).toBe('files:files');
    expect(results[0]?.entry).toBeUndefined();
  });

  test('filterSettingsItems keeps sections that match via an entry', () => {
    expect(filterSettingsItems(items, 'sign out').map((i) => i.key)).toEqual([
      'auth:security',
    ]);
  });
});

describe('SettingsSidebar (Shell-hosted)', () => {
  test('search mode lists individual settings with their section as context', () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        extensions={extensions}
        contributions={contributions}
        initialQuery="pwd"
      />,
    );
    expect(html).toContain('data-mode="search"');
    expect(html).toContain(
      'data-settings-result="auth:security#change-password"',
    );
    expect(html).toContain('Change password');
    expect(html).toContain('Account › Security');
    expect(html).not.toContain('data-settings-key="files:files"');
  });

  test('search mode shows an empty state for no matches', () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        extensions={extensions}
        contributions={contributions}
        initialQuery="zzzzqq"
      />,
    );
    expect(html).toContain('No matching settings');
  });

  test('renders scrollable nav of registered sections without any main view', () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        extensions={extensions}
        contributions={contributions}
        selectedKey="files:files"
      />,
    );

    expect(html).toContain('data-slot="settings-sidebar"');
    expect(html).toContain('data-slot="settings-sidebar-nav"');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('data-settings-key="auth:profile"');
    expect(html).toContain('data-settings-key="files:files"');
    expect(html).toContain('data-settings-key="crm:crm"');
    expect(html).not.toContain('data-slot="settings-view"');
    expect(html).not.toContain('data-view="settings"');
  });

  test('omits sections of extensions without an enabled settings contribution', () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        extensions={extensions}
        contributions={contributions.filter((c) => c.extensionId === 'files')}
      />,
    );
    expect(html).toContain('data-settings-key="files:files"');
    expect(html).not.toContain('data-settings-key="auth:profile"');
  });

  test('renders empty state when no extensions register settings', () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar extensions={extensions} contributions={[]} />,
    );
    expect(html).toContain('No extension settings registered');
  });
});

describe('SettingsView (main)', () => {
  test('shows only the selected section and mounts settings frames', () => {
    const html = renderToStaticMarkup(
      <SettingsView
        extensions={extensions}
        contributions={contributions}
        selectedKey="files:files"
      />,
    );

    expect(html).toContain('data-slot="settings-view"');
    expect(html).toContain('data-slot="settings-content"');
    expect(html).not.toContain('data-slot="settings-sidebar"');
    expect(html).toContain('data-extension-id="files"');
    expect(html).toContain('data-view="settings"');
    expect(html).toContain('Configure bin retention.');
  });

  test('renders empty state when no extensions register settings', () => {
    const html = renderToStaticMarkup(
      <SettingsView extensions={extensions} contributions={[]} />,
    );
    expect(html).toContain('No settings available');
  });
});
