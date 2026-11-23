import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AccountPanel } from '../ui/account-panel';

const noopAsync = async () => {};

const signedIn = {
  user: {
    id: 'u1',
    email: 'admin@example.com',
    name: 'Admin',
  },
  roles: ['admin', 'viewer'],
  orgId: 'org-1',
  orgs: [{ id: 'org-1', name: 'Demo Organization', role: 'owner' }],
};

const panelProps = {
  onSaveName: noopAsync,
  onChangePassword: noopAsync,
  onCreateOrg: noopAsync,
  onSwitchOrg: noopAsync,
  onSignOut: noopAsync,
};

describe('AccountPanel', () => {
  test('renders loading state when session is null', () => {
    const html = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: null,
        section: 'profile',
        ...panelProps,
      }),
    );
    expect(html).toContain('Account');
    expect(html).toContain('Loading session');
    expect(html).not.toContain('data-slot="account-panel"');
  });

  test('renders unsigned-in state', () => {
    const html = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: { user: null, roles: [], orgId: null, orgs: [] },
        section: 'profile',
        error: 'Auth API unreachable (502).',
        ...panelProps,
      }),
    );
    expect(html).toContain('You are not signed in');
    expect(html).toContain('/login');
    expect(html).toContain('Auth API unreachable');
    expect(html).not.toContain('data-slot="account-profile"');
  });

  test('renders only the selected profile section', () => {
    const html = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: signedIn,
        section: 'profile',
        ...panelProps,
      }),
    );
    expect(html).toContain('data-slot="account-panel"');
    expect(html).toContain('data-account-section="profile"');
    expect(html).toContain('data-slot="account-profile"');
    expect(html).toContain('account-email');
    expect(html).toContain('admin@example.com');
    expect(html).not.toContain('data-slot="account-roles"');
    expect(html).not.toContain('data-slot="account-security"');
    expect(html).not.toContain('data-slot="account-session"');
    expect(html).not.toContain('data-slot="account-organization"');
  });

  test('renders organization section when selected', () => {
    const html = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: signedIn,
        section: 'organization',
        ...panelProps,
      }),
    );
    expect(html).toContain('data-slot="account-organization"');
    expect(html).toContain('Demo Organization');
    expect(html).toContain('Active');
    expect(html).not.toContain('data-slot="account-profile"');
  });

  test('renders roles section when selected', () => {
    const html = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: signedIn,
        section: 'roles',
        ...panelProps,
      }),
    );
    expect(html).toContain('data-slot="account-roles"');
    expect(html).toContain('admin');
    expect(html).toContain('viewer');
    expect(html).not.toContain('data-slot="account-profile"');
  });

  test('renders security and session sections when selected', () => {
    const security = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: signedIn,
        section: 'security',
        ...panelProps,
      }),
    );
    expect(security).toContain('data-slot="account-security"');

    const sessionHtml = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: signedIn,
        section: 'session',
        ...panelProps,
      }),
    );
    expect(sessionHtml).toContain('data-slot="account-session"');
  });

  test('shows empty roles message when none assigned', () => {
    const html = renderToStaticMarkup(
      createElement(AccountPanel, {
        session: {
          user: signedIn.user,
          roles: [],
          orgId: null,
          orgs: [],
        },
        section: 'roles',
        ...panelProps,
      }),
    );
    expect(html).toContain('No roles assigned');
  });
});
