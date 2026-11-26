export const EMAIL_SECTIONS = [
  'inbox',
  'deliveries',
  'compose',
  'addresses',
] as const;

export type EmailSection = (typeof EMAIL_SECTIONS)[number];

export const EMAIL_SECTION_STORAGE_KEY = 'email.section';

/** Bus topic so Email page + sidebar iframes stay in sync (see `meta.json`). */
export const EMAIL_SECTION_TOPIC = 'inbound-email.section.changed';

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
