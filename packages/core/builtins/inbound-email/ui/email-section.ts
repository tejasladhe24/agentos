export const EMAIL_SECTIONS = [
  'inbox',
  'deliveries',
  'compose',
  'addresses',
] as const;

export type EmailSection = (typeof EMAIL_SECTIONS)[number];

export const EMAIL_SECTION_STORAGE_KEY = 'email.section';

/** Same-origin channel so Email page + sidebar iframes stay in sync. */
export const EMAIL_SECTION_CHANNEL = 'agentos.inbound-email.section';

export const EMAIL_SECTION_LABELS: Record<EmailSection, string> = {
  inbox: 'Inbox',
  deliveries: 'Deliveries',
  compose: 'Compose',
  addresses: 'Addresses',
};

export const DEFAULT_EMAIL_SECTION: EmailSection = 'inbox';

export function isEmailSection(value: unknown): value is EmailSection {
  return (
    typeof value === 'string' &&
    (EMAIL_SECTIONS as readonly string[]).includes(value)
  );
}

export function parseEmailSection(value: unknown): EmailSection {
  return isEmailSection(value) ? value : DEFAULT_EMAIL_SECTION;
}
