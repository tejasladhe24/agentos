import { useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';
import { Label } from '@agentos/ui/components/label';
import { Textarea } from '@agentos/ui/components/textarea';

import { parseErrorBody, type DeliveryEntry } from './email-types';

const TEMPLATES = [
  { id: '', label: 'None' },
  { id: 'client-reminder', label: 'client-reminder' },
  { id: 'digest', label: 'digest' },
] as const;

export function ComposeSection({ canSend }: { canSend: boolean }) {
  const api = useHostApi();
  const toast = useHostNotifications();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [varsJson, setVarsJson] = useState('{}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDelivery, setLastDelivery] = useState<DeliveryEntry | null>(null);

  if (!canSend) {
    return (
      <section className="flex flex-col gap-2" aria-label="Compose">
        <h2 className="text-base font-semibold">Compose</h2>
        <p className="text-sm text-muted-foreground">
          You need the <code>email.send</code> permission to compose.
        </p>
      </section>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setLastDelivery(null);

    let vars: Record<string, string> | undefined;
    if (templateId) {
      try {
        const parsed = JSON.parse(varsJson) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('vars must be a JSON object');
        }
        vars = {};
        for (const [k, v] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (typeof v === 'string') vars[k] = v;
        }
      } catch (err) {
        setBusy(false);
        setError(err instanceof Error ? err.message : 'Invalid vars JSON');
        return;
      }
    }

    const body: Record<string, unknown> = {
      channel: 'email',
      to: to.trim(),
      subject: subject.trim() || undefined,
      message: message.trim() || undefined,
    };
    if (templateId) {
      body.templateId = templateId;
      body.vars = vars;
    }

    const res = await api.fetch('/api/ext/notifications/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError(parseErrorBody(res.body, 'Send failed'));
      return;
    }
    const payload = JSON.parse(res.body) as { notification: DeliveryEntry };
    setLastDelivery(payload.notification);
    await toast.show(
      `Email ${payload.notification.status} (${payload.notification.id})`,
      payload.notification.status === 'failed' ? 'error' : 'success',
    );
  }

  return (
    <section className="flex max-w-lg flex-col gap-4" aria-label="Compose">
      <header>
        <h2 className="text-base font-semibold">Compose</h2>
        <p className="text-sm text-muted-foreground">
          Sends via notifications email channel (log / Resend / Cloudflare).
        </p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="compose-to">To</Label>
          <Input
            id="compose-to"
            type="email"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="client@example.com"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="compose-subject">Subject</Label>
          <Input
            id="compose-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Optional when using a template"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium" id="compose-template-label">
            Template
          </span>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-labelledby="compose-template-label"
          >
            {TEMPLATES.map((t) => (
              <Button
                key={t.id || 'none'}
                type="button"
                size="sm"
                variant={templateId === t.id ? 'secondary' : 'ghost'}
                onClick={() => setTemplateId(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>
        {templateId ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="compose-vars">Template vars (JSON)</Label>
            <Textarea
              id="compose-vars"
              value={varsJson}
              onChange={(e) => setVarsJson(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="compose-message">Message</Label>
            <Textarea
              id="compose-message"
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
            />
          </div>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {lastDelivery ? (
          <p className="text-sm text-muted-foreground">
            Delivery <code>{lastDelivery.id}</code> — {lastDelivery.status}
            {lastDelivery.provider ? ` via ${lastDelivery.provider}` : ''}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send email'}
        </Button>
      </form>
    </section>
  );
}
