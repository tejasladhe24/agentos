export const ACCOUNT_SECTIONS = [
  'profile',
  'organization',
  'roles',
  'security',
  'session',
] as const;

export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

export const ACCOUNT_SECTION_STORAGE_KEY = 'account.section';

/** Same-origin channel so auth page + sidebar iframes stay in sync. */
export const ACCOUNT_SECTION_CHANNEL = 'agentos.auth.account.section';

export const ACCOUNT_SECTION_LABELS: Record<AccountSection, string> = {
  profile: 'Profile',
  organization: 'Organization',
  roles: 'Roles',
  security: 'Security',
  session: 'Session',
};

export const DEFAULT_ACCOUNT_SECTION: AccountSection = 'profile';

export function isAccountSection(value: unknown): value is AccountSection {
  return (
    typeof value === 'string' &&
    (ACCOUNT_SECTIONS as readonly string[]).includes(value)
  );
}

export function parseAccountSection(value: unknown): AccountSection {
  return isAccountSection(value) ? value : DEFAULT_ACCOUNT_SECTION;
}
