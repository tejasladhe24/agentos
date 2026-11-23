export type NotificationTemplate = {
  id: string;
  /** Email subject; ignored for SMS. Supports `{{var}}`. */
  subject?: string;
  /** Body text (plain). Supports `{{var}}`. */
  body: string;
};

/**
 * Built-in template catalog (ticket 73).
 * Ids are stable; vars use `{{name}}` substitution (missing → empty string).
 */
export const TEMPLATES: Record<string, NotificationTemplate> = {
  'client-reminder': {
    id: 'client-reminder',
    subject: 'Reminder: {{title}}',
    body: 'Hi {{name}},\n\n{{message}}\n\n— {{appName}}',
  },
  digest: {
    id: 'digest',
    subject: 'Daily digest — {{date}}',
    body: '{{summary}}',
  },
};

export function getTemplate(id: string): NotificationTemplate | undefined {
  return TEMPLATES[id];
}
