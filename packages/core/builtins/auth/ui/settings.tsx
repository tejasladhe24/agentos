import { parseErrorBody } from '@agentos/core/client/lib/host-json';
import { SettingsPage } from '@agentos/core/client/components/settings-page';
import { useCallback, useEffect, useState } from 'react';
import {
  useHostApi,
  useHostNotifications,
  useSettingsTarget,
} from '@agentos/core/client';
import {
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@agentos/ui/components/field';
import { LoadingState } from '@agentos/ui/components/loading-state';

import { AccountMembersSection } from './components/account-members-section';
import { AccountOrganizationSection } from './components/account-organization-section';
import { AccountProfileSection } from './components/account-profile-section';
import { AccountRolesSection } from './components/account-roles-section';
import { AccountSecuritySection } from './components/account-security-section';
import { AccountSessionSection } from './components/account-session-section';
import {
  isAdminSessionRoles,
  type AccountOrgInvite,
  type AccountOrgMember,
  type AccountRoleEntry,
  type AccountSessionView,
} from './lib/account-types';

type AuthSettingsSectionId = 'profile' | 'organization';

function parseAuthSettingsSection(raw: string): AuthSettingsSectionId {
  if (raw === 'organization' || raw === 'roles') return 'organization';
  return 'profile';
}

function parseSession(body: string): AccountSessionView {
  const data = JSON.parse(body) as AccountSessionView;
  return {
    user: data.user ?? null,
    roles: data.roles ?? [],
    orgId: data.orgId ?? null,
    orgs: data.orgs ?? [],
  };
}

function parseRolesPayload(body: string): AccountRoleEntry[] {
  const data = JSON.parse(body) as {
    roles?: string[];
    permissions?: Array<{ role: string; permission: string }>;
  };
  const permsByRole = new Map<string, string[]>();
  for (const role of data.roles ?? []) {
    permsByRole.set(role, []);
  }
  for (const row of data.permissions ?? []) {
    const list = permsByRole.get(row.role) ?? [];
    list.push(row.permission);
    permsByRole.set(row.role, list);
  }
  return [...permsByRole.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, permissions]) => ({ role, permissions }));
}

function parseMembersPayload(body: string): {
  members: AccountOrgMember[];
  invites: AccountOrgInvite[];
} {
  const data = JSON.parse(body) as {
    members?: AccountOrgMember[];
    invites?: AccountOrgInvite[];
  };
  return {
    members: data.members ?? [],
    invites: data.invites ?? [],
  };
}

/**
 * Auth extension settings view — mounted by the Shell Settings host.
 *
 * - `profile`: Profile, Security, and Session
 * - `organization`: Organizations, Roles, and Members
 */
export default function AuthSettings() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const target = useSettingsTarget();
  const section = parseAuthSettingsSection(target.section);
  const [session, setSession] = useState<AccountSessionView | null>(null);
  const [availableRoles, setAvailableRoles] = useState<AccountRoleEntry[]>([]);
  const [members, setMembers] = useState<AccountOrgMember[]>([]);
  const [invites, setInvites] = useState<AccountOrgInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshOrgDetails = useCallback(async () => {
    const [rolesRes, membersRes] = await Promise.all([
      api.fetch('/roles'),
      api.fetch('/orgs/members'),
    ]);
    if (rolesRes.ok) {
      try {
        setAvailableRoles(parseRolesPayload(rolesRes.body));
      } catch {
        setAvailableRoles([]);
      }
    }
    if (membersRes.ok) {
      try {
        const parsed = parseMembersPayload(membersRes.body);
        setMembers(parsed.members);
        setInvites(parsed.invites);
      } catch {
        setMembers([]);
        setInvites([]);
      }
    }
  }, [api]);

  const refreshSession = useCallback(async () => {
    const res = await api.fetch('/session');
    if (res.status === 401) {
      setSession({ user: null, roles: [], orgId: null, orgs: [] });
      return;
    }
    if (!res.ok) {
      setSession({ user: null, roles: [], orgId: null, orgs: [] });
      if (res.status === 502) {
        const message =
          'Auth API unreachable (502). Run: pnpm --filter @agentos/core run auth:dev';
        setError(message);
        void notifications.show(message, 'error');
      }
      return;
    }
    const next = parseSession(res.body);
    setSession(next);
    setError(null);
    if (next.user && next.orgId) {
      await refreshOrgDetails();
    } else {
      setAvailableRoles([]);
      setMembers([]);
      setInvites([]);
    }
  }, [api, notifications, refreshOrgDetails]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  async function onSaveName(name: string) {
    const res = await api.fetch('/update-profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to update name'));
    }
    setSession(parseSession(res.body));
    await notifications.show('Display name updated', 'info');
  }

  async function onChangePassword(input: {
    currentPassword: string;
    newPassword: string;
  }) {
    const res = await api.fetch('/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to change password'));
    }
    await notifications.show('Password updated', 'info');
    await refreshSession();
  }

  async function onCreateOrg(name: string) {
    const res = await api.fetch('/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(
        parseErrorBody(res.body, 'Failed to create organization'),
      );
    }
    setSession(parseSession(res.body));
    await refreshOrgDetails();
    await notifications.show('Organization created', 'info');
  }

  async function onSwitchOrg(orgId: string) {
    const res = await api.fetch('/orgs/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId }),
    });
    if (!res.ok) {
      throw new Error(
        parseErrorBody(res.body, 'Failed to switch organization'),
      );
    }
    setSession(parseSession(res.body));
    await refreshOrgDetails();
    await notifications.show('Organization switched', 'info');
  }

  async function onUpdateOrg(orgId: string, name: string) {
    const res = await api.fetch(`/orgs/${encodeURIComponent(orgId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      throw new Error(
        parseErrorBody(res.body, 'Failed to update organization'),
      );
    }
    setSession(parseSession(res.body));
    await notifications.show('Organization updated', 'info');
  }

  async function onDeleteOrg(orgId: string) {
    const res = await api.fetch(`/orgs/${encodeURIComponent(orgId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(
        parseErrorBody(res.body, 'Failed to delete organization'),
      );
    }
    setSession(parseSession(res.body));
    await refreshOrgDetails();
    await notifications.show('Organization deleted', 'info');
  }

  async function onSaveRole(role: string, permissions: string[]) {
    const res = await api.fetch(
      `/roles/${encodeURIComponent(role)}/permissions`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permissions }),
      },
    );
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to save role'));
    }
    await refreshOrgDetails();
    await notifications.show(`Role "${role}" saved`, 'info');
  }

  async function onDeleteRole(role: string) {
    const res = await api.fetch(`/roles/${encodeURIComponent(role)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to delete role'));
    }
    setAvailableRoles(parseRolesPayload(res.body));
    await notifications.show(`Role "${role}" deleted`, 'info');
  }

  async function onInviteMember(input: { email: string; role: string }) {
    const res = await api.fetch('/orgs/members/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to invite member'));
    }
    const parsed = parseMembersPayload(res.body);
    setMembers(parsed.members);
    setInvites(parsed.invites);
    const data = JSON.parse(res.body) as { status?: string };
    await notifications.show(
      data.status === 'added'
        ? `${input.email} added to organization`
        : `Invite sent to ${input.email}`,
      'info',
    );
  }

  async function onRevokeInvite(inviteId: string) {
    const res = await api.fetch(
      `/orgs/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to revoke invite'));
    }
    const data = JSON.parse(res.body) as { invites?: AccountOrgInvite[] };
    setInvites(data.invites ?? []);
    await notifications.show('Invite revoked', 'info');
  }

  async function onChangeMemberRole(userId: string, role: string) {
    const res = await api.fetch('/orgs/members/roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to update member role'));
    }
    setMembers(parseMembersPayload(res.body).members);
    await notifications.show('Member role updated', 'info');
  }

  async function onRemoveMember(userId: string) {
    const res = await api.fetch('/orgs/members/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      throw new Error(parseErrorBody(res.body, 'Failed to remove member'));
    }
    setMembers(parseMembersPayload(res.body).members);
    await notifications.show('Member removed', 'info');
  }

  async function onSignOut() {
    setBusy(true);
    setError(null);
    try {
      await api.fetch('/sign-out', { method: 'POST' });
      setSession({ user: null, roles: [], orgId: null, orgs: [] });
      await notifications.show('Signed out', 'info');
      window.top!.location.assign('/login');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Account children render failures inline; also toast them so operational
   * errors reach the notifications inbox. The error is rethrown so the child
   * still shows its inline message.
   */
  const toastFailures =
    <A extends unknown[], R>(action: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await action(...args);
      } catch (err) {
        void notifications.show(
          err instanceof Error ? err.message : 'Account action failed',
          'error',
        );
        throw err;
      }
    };

  const isAdmin = session ? isAdminSessionRoles(session.roles) : false;

  return (
    <SettingsPage data-slot="auth-settings" data-account-section={section}>
      {!session ? (
        <LoadingState size="sm">Loading session…</LoadingState>
      ) : !session.user ? (
        <FieldSet>
          <FieldLegend>Not signed in</FieldLegend>
          <FieldDescription>
            Open <span className="font-medium text-foreground">/login</span> to
            authenticate.
          </FieldDescription>
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldSet>
      ) : (
        <FieldGroup className="gap-8">
          {error ? <FieldError>{error}</FieldError> : null}
          {section === 'profile' ? (
            <>
              <AccountProfileSection
                email={session.user.email}
                name={session.user.name}
                busy={busy}
                onSaveName={toastFailures(onSaveName)}
              />
              <FieldSeparator />
              <AccountSecuritySection
                busy={busy}
                onChangePassword={toastFailures(onChangePassword)}
              />
              <FieldSeparator />
              <AccountSessionSection
                busy={busy}
                onSignOut={toastFailures(onSignOut)}
              />
            </>
          ) : (
            <>
              <AccountOrganizationSection
                orgId={session.orgId}
                orgs={session.orgs}
                isAdmin={isAdmin}
                busy={busy}
                onCreateOrg={toastFailures(onCreateOrg)}
                onSwitchOrg={toastFailures(onSwitchOrg)}
                onUpdateOrg={toastFailures(onUpdateOrg)}
                onDeleteOrg={toastFailures(onDeleteOrg)}
              />
              <FieldSeparator />
              <AccountRolesSection
                roles={session.roles}
                availableRoles={availableRoles}
                isAdmin={isAdmin}
                busy={busy}
                onSaveRole={toastFailures(onSaveRole)}
                onDeleteRole={toastFailures(onDeleteRole)}
              />
              <FieldSeparator />
              <AccountMembersSection
                members={members}
                invites={invites}
                currentUserId={session.user.id}
                availableRoles={availableRoles.map((r) => r.role)}
                isAdmin={isAdmin}
                busy={busy}
                onInviteMember={toastFailures(onInviteMember)}
                onRevokeInvite={toastFailures(onRevokeInvite)}
                onChangeMemberRole={toastFailures(onChangeMemberRole)}
                onRemoveMember={toastFailures(onRemoveMember)}
              />
            </>
          )}
        </FieldGroup>
      )}
    </SettingsPage>
  );
}
