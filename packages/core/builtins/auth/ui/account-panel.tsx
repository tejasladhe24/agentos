import { ACCOUNT_SECTION_LABELS, type AccountSection } from './account-section';
import { AccountOrganizationSection } from './account-organization-section';
import { AccountProfileSection } from './account-profile-section';
import { AccountRolesSection } from './account-roles-section';
import { AccountSecuritySection } from './account-security-section';
import { AccountSessionSection } from './account-session-section';
import type { AccountSessionView } from './account-types';

export type AccountPanelProps = {
  session: AccountSessionView | null;
  section: AccountSection;
  error?: string | null;
  busy?: boolean;
  onSaveName: (name: string) => Promise<void>;
  onChangePassword: (input: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<void>;
  onCreateOrg: (name: string) => Promise<void>;
  onSwitchOrg: (orgId: string) => Promise<void>;
  onSignOut: () => void | Promise<void>;
};

export function AccountPanel({
  session,
  section,
  error = null,
  busy = false,
  onSaveName,
  onChangePassword,
  onCreateOrg,
  onSwitchOrg,
  onSignOut,
}: AccountPanelProps) {
  if (!session) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
        <header>
          <h1 className="text-lg font-semibold">Account</h1>
          <p className="text-sm text-muted-foreground">Loading session…</p>
        </header>
      </main>
    );
  }

  if (!session.user) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-6">
        <header>
          <h1 className="text-lg font-semibold">Account</h1>
          <p className="text-sm text-muted-foreground">
            You are not signed in. Open{' '}
            <span className="font-medium text-foreground">/login</span> to
            authenticate.
          </p>
        </header>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main
      className="mx-auto flex w-full max-w-md flex-col gap-6 p-6"
      data-slot="account-panel"
      data-account-section={section}
    >
      <header>
        <h1 className="text-lg font-semibold">
          {ACCOUNT_SECTION_LABELS[section]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Account settings — use the sidebar to switch sections
        </p>
      </header>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {section === 'profile' ? (
        <AccountProfileSection
          email={session.user.email}
          name={session.user.name}
          busy={busy}
          onSaveName={onSaveName}
        />
      ) : null}
      {section === 'organization' ? (
        <AccountOrganizationSection
          orgId={session.orgId}
          orgs={session.orgs}
          busy={busy}
          onCreateOrg={onCreateOrg}
          onSwitchOrg={onSwitchOrg}
        />
      ) : null}
      {section === 'roles' ? (
        <AccountRolesSection roles={session.roles} />
      ) : null}
      {section === 'security' ? (
        <AccountSecuritySection
          busy={busy}
          onChangePassword={onChangePassword}
        />
      ) : null}
      {section === 'session' ? (
        <AccountSessionSection busy={busy} onSignOut={onSignOut} />
      ) : null}
    </main>
  );
}
