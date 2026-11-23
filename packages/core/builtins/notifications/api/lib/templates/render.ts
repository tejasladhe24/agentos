import { getTemplate } from './catalog';

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Replace `{{var}}` placeholders; unknown keys become empty strings. */
export function renderTemplateString(
  source: string,
  vars: Record<string, string> = {},
): string {
  return source.replace(VAR_RE, (_match, key: string) => vars[key] ?? '');
}

export type RenderedNotification = {
  subject?: string;
  body: string;
  templateId?: string;
};

/**
 * Resolve message/subject from optional templateId + vars, else raw message/subject.
 */
export function renderNotificationContent(input: {
  message?: string;
  subject?: string;
  templateId?: string;
  vars?: Record<string, string>;
}): { ok: true; value: RenderedNotification } | { ok: false; error: string } {
  const vars = input.vars ?? {};

  if (input.templateId) {
    const template = getTemplate(input.templateId);
    if (!template) {
      return { ok: false, error: `unknown templateId: ${input.templateId}` };
    }
    const body = renderTemplateString(template.body, vars);
    const subjectSource = input.subject ?? template.subject;
    const value: RenderedNotification = {
      body,
      templateId: template.id,
    };
    if (subjectSource !== undefined) {
      value.subject = renderTemplateString(subjectSource, vars);
    }
    return { ok: true, value };
  }

  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) {
    return { ok: false, error: 'message required (or provide templateId)' };
  }
  const value: RenderedNotification = { body: message };
  if (typeof input.subject === 'string' && input.subject.trim()) {
    value.subject = input.subject.trim();
  }
  return { ok: true, value };
}
