import { Button } from '@agentos/ui/components/button';
import { cn } from '@agentos/ui/lib/utils';

import {
  ACCOUNT_SECTION_LABELS,
  ACCOUNT_SECTIONS,
  type AccountSection,
} from './account-section';
import { useAccountSection } from './use-account-section';

/**
 * Auth account nav — left sidebar when Auth is the active secondary view.
 * Selecting an item updates the account page section (shared storage + channel).
 */
export default function AuthAccountSidebar() {
  const [section, selectSection] = useAccountSection();

  return (
    <nav
      className="flex h-full flex-col gap-4 p-4"
      data-slot="auth-account-sidebar"
      aria-label="Account settings"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Account</h2>
        <p className="text-xs text-muted-foreground">
          Profile, organization, roles, and security
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {ACCOUNT_SECTIONS.map((id) => (
          <li key={id}>
            <AccountNavButton
              section={id}
              active={section === id}
              onSelect={selectSection}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AccountNavButton({
  section,
  active,
  onSelect,
}: {
  section: AccountSection;
  active: boolean;
  onSelect: (section: AccountSection) => void | Promise<void>;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      className={cn('w-full justify-start', active && 'font-medium')}
      aria-current={active ? 'page' : undefined}
      data-account-section={section}
      data-active={active ? 'true' : 'false'}
      onClick={() => void onSelect(section)}
    >
      {ACCOUNT_SECTION_LABELS[section]}
    </Button>
  );
}
