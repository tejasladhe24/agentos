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

import { AccountOrganizationSection } from './account-organization-section';
import { AccountProfileSection } from './account-profile-section';
import { AccountRolesSection } from './account-roles-section';
import { AccountSecuritySection } from './account-security-section';
import { AccountSessionSection } from './account-session-section';
import type { AccountSessionView } from './account-types';

type AuthSettingsSectionId = 'profile' | 'organization';

function parseAuthSettingsSection(raw: string): AuthSettingsSectionId {
  if (raw === 'organization' || raw === 'roles') return 'organization';
  return 'profile';
}

function parseErrorBody(body: string, fallback: string): string {
  try {
    const data = JSON.parse(body) as { error?: string; message?: string };
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
  } catch {
    // ignore non-JSON
  }
  return body.trim() || fallback;
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

/**
 * Auth extension settings view — mounted by the Shell Settings host.
 *
 * - `profile`: Profile, Security, and Session
 * - `organization`: Organization and Roles
 */
export default function AuthSettings() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const target = useSettingsTarget();
  const section = parseAuthSettingsSection(target.section);
  const [session, setSession] = useState<AccountSessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const res = await api.fetch('/session');
    if (res.status === 401) {
      setSession({ user: null, roles: [], orgId: null, orgs: [] });
      return;
    }
    if (!res.ok) {
      setSession({ user: null, roles: [], orgId: null, orgs: [] });
      if (res.status === 502) {
        setError(
          'Auth API unreachable (502). Run: pnpm --filter @agentos/core run auth:dev',
        );
      }
      return;
    }
    setSession(parseSession(res.body));
    setError(null);
  }, [api]);

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
    await notifications.show('Organization switched', 'info');
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

  return (
    <div
      className="fixed inset-0 overflow-y-auto bg-background px-6 py-6 text-foreground"
      data-slot="auth-settings"
      data-account-section={section}
    >
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
                onSaveName={onSaveName}
              />
              <FieldSeparator />
              <AccountSecuritySection
                busy={busy}
                onChangePassword={onChangePassword}
              />
              <FieldSeparator />
              <AccountSessionSection busy={busy} onSignOut={onSignOut} />
            </>
          ) : (
            <>
              <AccountOrganizationSection
                orgId={session.orgId}
                orgs={session.orgs}
                busy={busy}
                onCreateOrg={onCreateOrg}
                onSwitchOrg={onSwitchOrg}
              />
              <FieldSeparator />
              <AccountRolesSection roles={session.roles} />
            </>
          )}
        </FieldGroup>
      )}
    </div>
  );
}
