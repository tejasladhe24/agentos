import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
  useHostNotifications,
} from '@agentos/core/client';
import { Button } from '@agentos/ui/components/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import { Textarea } from '@agentos/ui/components/textarea';

import type { DeliveryEntry } from '../lib/email-types';

const TEMPLATES = [
  { id: '', label: 'None' },
  { id: 'client-reminder', label: 'client-reminder' },
  { id: 'digest', label: 'digest' },
] as const;

function parseTemplateVars(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') vars[k] = v;
    }
    return vars;
  } catch {
    return null;
  }
}

const composeSchema = z
  .object({
    to: z.string().trim().email('Enter a valid recipient email address'),
    subject: z.string(),
    message: z.string(),
    templateId: z.string(),
    varsJson: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.templateId) {
      if (parseTemplateVars(data.varsJson) === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'Template vars must be a valid JSON object',
          path: ['varsJson'],
        });
      }
    } else if (!data.message.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Message is required',
        path: ['message'],
      });
    }
  });

export function ComposeSection({ canSend }: { canSend: boolean }) {
  const toast = useHostNotifications();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastDelivery, setLastDelivery] = useState<DeliveryEntry | null>(null);

  const form = useForm({
    defaultValues: {
      to: '',
      subject: '',
      message: '',
      templateId: '',
      varsJson: '{}',
    },
    validators: {
      onSubmit: composeSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      setLastDelivery(null);

      const body: Record<string, unknown> = {
        channel: 'email',
        to: value.to.trim(),
        subject: value.subject.trim() || undefined,
        message: value.message.trim() || undefined,
      };
      if (value.templateId) {
        body.templateId = value.templateId;
        body.vars = parseTemplateVars(value.varsJson) ?? {};
      }

      let delivery: DeliveryEntry;
      try {
        delivery = (await toast.send(body)) as DeliveryEntry;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Send failed';
        setSubmitError(message);
        await toast.show(message, 'error');
        return;
      }
      setLastDelivery(delivery);
      await toast.show(
        `Email ${delivery.status} (${delivery.id})`,
        delivery.status === 'failed' ? 'error' : 'success',
      );
    },
  });

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

  return (
    <section className="flex max-w-lg flex-col gap-4" aria-label="Compose">
      <header>
        <h2 className="text-base font-semibold">Compose</h2>
        <p className="text-sm text-muted-foreground">
          Sends via notifications email channel (log / Resend / Cloudflare).
        </p>
      </header>

      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FieldGroup className="gap-3">
          <form.Field name="to">
            {(field) => {
              const invalid = isFieldInvalid(field.state.meta);
              return (
                <Field data-invalid={invalid || undefined}>
                  <FieldLabel htmlFor="compose-to">To</FieldLabel>
                  <Input
                    id="compose-to"
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      if (submitError) setSubmitError(null);
                    }}
                    placeholder="client@example.com"
                    aria-invalid={invalid || undefined}
                  />
                  {invalid ? (
                    <FieldError
                      errors={toFieldErrors(field.state.meta.errors)}
                    />
                  ) : null}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="subject">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="compose-subject">Subject</FieldLabel>
                <Input
                  id="compose-subject"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    if (submitError) setSubmitError(null);
                  }}
                  placeholder="Optional when using a template"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="templateId">
            {(field) => (
              <Field>
                <FieldLabel id="compose-template-label">Template</FieldLabel>
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
                      variant={
                        field.state.value === t.id ? 'secondary' : 'ghost'
                      }
                      onClick={() => field.handleChange(t.id)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.templateId}>
            {(templateId) =>
              templateId ? (
                <form.Field name="varsJson">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor="compose-vars">
                          Template vars (JSON)
                        </FieldLabel>
                        <Textarea
                          id="compose-vars"
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                            if (submitError) setSubmitError(null);
                          }}
                          rows={4}
                          className="font-mono text-xs"
                          aria-invalid={invalid || undefined}
                        />
                        {invalid ? (
                          <FieldError
                            errors={toFieldErrors(field.state.meta.errors)}
                          />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
              ) : (
                <form.Field name="message">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor="compose-message">
                          Message
                        </FieldLabel>
                        <Textarea
                          id="compose-message"
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                            if (submitError) setSubmitError(null);
                          }}
                          rows={6}
                          aria-invalid={invalid || undefined}
                        />
                        {invalid ? (
                          <FieldError
                            errors={toFieldErrors(field.state.meta.errors)}
                          />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
              )
            }
          </form.Subscribe>
          {submitError ? <FieldError>{submitError}</FieldError> : null}
          {lastDelivery ? (
            <p className="text-sm text-muted-foreground">
              Delivery <code>{lastDelivery.id}</code> — {lastDelivery.status}
              {lastDelivery.provider ? ` via ${lastDelivery.provider}` : ''}
            </p>
          ) : null}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send email'}
              </Button>
            )}
          </form.Subscribe>
        </FieldGroup>
      </form>
    </section>
  );
}
