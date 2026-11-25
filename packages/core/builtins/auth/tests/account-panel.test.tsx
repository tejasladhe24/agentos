import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AccountMembersSection } from '../ui/account-members-section';
import { AccountOrganizationSection } from '../ui/account-organization-section';
import { AccountPanel } from '../ui/account-panel';
import { AccountRolesSection } from '../ui/account-roles-section';

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
    expect(html).toContain('data-state="selected"');
    expect(html).toContain('aria-label="Active organization"');
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

  test('organization, roles, and members tables gate create & 3-dot actions to admins', () => {
    const orgs = [
      { id: 'org-1', name: 'Demo Organization', role: 'owner' },
      { id: 'org-2', name: 'Second Org', role: 'viewer' },
    ];
    const orgNonAdmin = renderToStaticMarkup(
      createElement(AccountOrganizationSection, {
        orgId: 'org-1',
        orgs,
        isAdmin: false,
        onCreateOrg: noopAsync,
        onSwitchOrg: noopAsync,
      }),
    );
    expect(orgNonAdmin).toContain('data-slot="organizations-table"');
    expect(orgNonAdmin).toContain('data-slot="organizations-search"');
    expect(orgNonAdmin).toContain('data-slot="organizations-filter"');
    expect(orgNonAdmin).toContain('data-slot="organizations-sort"');
    expect(orgNonAdmin).not.toContain('data-slot="create-org-trigger"');
    expect(orgNonAdmin).not.toContain('data-slot="org-row-actions"');
    expect(orgNonAdmin).toContain('Switch');

    const orgAdmin = renderToStaticMarkup(
      createElement(AccountOrganizationSection, {
        orgId: 'org-1',
        orgs,
        isAdmin: true,
        onCreateOrg: noopAsync,
        onSwitchOrg: noopAsync,
        onUpdateOrg: noopAsync,
        onDeleteOrg: noopAsync,
      }),
    );
    expect(orgAdmin).toContain('data-slot="create-org-trigger"');
    expect(orgAdmin).toContain('data-slot="org-row-actions"');

    const availableRoles = [
      { role: 'admin', permissions: ['*'] },
      { role: 'viewer', permissions: ['files.read', 'audit.read'] },
    ];
    const rolesNonAdmin = renderToStaticMarkup(
      createElement(AccountRolesSection, {
        roles: ['viewer'],
        availableRoles,
        isAdmin: false,
      }),
    );
    expect(rolesNonAdmin).toContain('data-slot="roles-table"');
    expect(rolesNonAdmin).toContain('data-slot="roles-search"');
    expect(rolesNonAdmin).toContain('data-slot="roles-filter"');
    expect(rolesNonAdmin).toContain('data-slot="roles-sort"');
    expect(rolesNonAdmin).toContain('admin');
    expect(rolesNonAdmin).toContain('viewer');
    expect(rolesNonAdmin).not.toContain('data-slot="role-row-actions"');

    const rolesAdmin = renderToStaticMarkup(
      createElement(AccountRolesSection, {
        roles: ['admin'],
        availableRoles,
        isAdmin: true,
        onSaveRole: noopAsync,
        onDeleteRole: noopAsync,
      }),
    );
    expect(rolesAdmin).toContain('data-slot="create-role-trigger"');
    expect(rolesAdmin).toContain('data-slot="role-row-actions"');

    const members = [
      {
        userId: 'u1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'owner',
      },
      {
        userId: 'u2',
        email: 'viewer@example.com',
        name: 'Viewer',
        role: 'viewer',
      },
    ];
    const membersNonAdmin = renderToStaticMarkup(
      createElement(AccountMembersSection, {
        members,
        currentUserId: 'u2',
        availableRoles: ['admin', 'viewer'],
        isAdmin: false,
      }),
    );
    expect(membersNonAdmin).toContain('data-slot="members-table"');
    expect(membersNonAdmin).toContain('data-slot="members-search"');
    expect(membersNonAdmin).toContain('data-slot="members-filter"');
    expect(membersNonAdmin).toContain('data-slot="members-sort"');
    expect(membersNonAdmin).toContain('admin@example.com');
    expect(membersNonAdmin).not.toContain('data-slot="invite-member-trigger"');
    expect(membersNonAdmin).not.toContain('data-slot="member-row-actions"');

    const membersAdmin = renderToStaticMarkup(
      createElement(AccountMembersSection, {
        members,
        invites: [
          {
            id: 'inv-1',
            orgId: 'org-1',
            email: 'pending@example.com',
            role: 'reviewer',
            invitedBy: 'admin@example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        currentUserId: 'u1',
        availableRoles: ['admin', 'viewer', 'reviewer'],
        isAdmin: true,
        onInviteMember: noopAsync,
        onRevokeInvite: noopAsync,
        onChangeMemberRole: noopAsync,
        onRemoveMember: noopAsync,
      }),
    );
    expect(membersAdmin).toContain('data-slot="invite-member-trigger"');
    expect(membersAdmin).toContain('data-slot="member-row-actions"');
    expect(membersAdmin).toContain('pending@example.com');
    expect(membersAdmin).toContain('data-slot="invite-row-actions"');
  });
});
