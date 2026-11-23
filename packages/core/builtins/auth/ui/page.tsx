import { useEffect, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';

import { AccountPanel } from './account-panel';
import type { AccountSessionView } from './account-types';
import { useAccountSection } from './use-account-section';

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
 * Auth secondary Activity Bar page — account settings (not public sign-in).
 * Public auth lives at `/login`, `/register`, `/reset-password` (Shell gate).
 */
export default function AuthAccountPage() {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [section] = useAccountSection();
  const [session, setSession] = useState<AccountSessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshSession() {
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
  }

  useEffect(() => {
    void refreshSession();
  }, []);

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
    <AccountPanel
      session={session}
      section={section}
      error={error}
      busy={busy}
      onSaveName={onSaveName}
      onChangePassword={onChangePassword}
      onCreateOrg={onCreateOrg}
      onSwitchOrg={onSwitchOrg}
      onSignOut={onSignOut}
    />
  );
}
