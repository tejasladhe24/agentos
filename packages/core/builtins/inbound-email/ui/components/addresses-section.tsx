import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  parseHostJson,
  isFieldInvalid,
  toFieldErrors,
  useHostApi,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

import { parseErrorBody, type InboundAddress } from '../lib/email-types';

const provisionAddressSchema = z.object({
  address: z.string().trim().email('Enter a valid email address'),
  purpose: z.string(),
});

export function AddressesSection({ canProvision }: { canProvision: boolean }) {
  const api = useHostApi();
  const toast = useHostNotifications();
  const [addresses, setAddresses] = useState<InboundAddress[]>([]);
  const [health, setHealth] = useState<{
    provider?: string;
    backend?: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setLoadError(null);
    const [listRes, healthRes] = await Promise.all([
      api.fetch('/addresses'),
      api.fetch('/health'),
    ]);
    setBusy(false);
    const list = parseHostJson<{ addresses?: InboundAddress[] }>(
      listRes,
      'Failed to load addresses',
    );
    if (!list.ok) {
      setLoadError(list.error);
      setAddresses([]);
    } else {
      setAddresses(list.data.addresses ?? []);
    }
    const healthJson = parseHostJson<{ provider?: string; backend?: string }>(
      healthRes,
    );
    if (healthJson.ok) setHealth(healthJson.data);
  }

  const form = useForm({
    defaultValues: { address: '', purpose: '' },
    validators: { onSubmit: provisionAddressSchema },
    onSubmit: async ({ value }) => {
      if (!canProvision) return;
      setSubmitError(null);
      const res = await api.fetch('/addresses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address: value.address.trim(),
          purpose: value.purpose.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const message = parseErrorBody(res.body, 'Provision failed');
        setSubmitError(message);
        await toast.show(message, 'error');
        return;
      }
      form.reset({ address: '', purpose: '' });
      await toast.show('Inbound address provisioned', 'success');
      await refresh();
    },
  });

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="flex flex-col gap-4" aria-label="Addresses">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Inbound addresses</h2>
          <p className="text-sm text-muted-foreground">
            Provision per-org receive addresses
            {health?.provider ? ` · provider ${health.provider}` : ''}
            {health?.backend ? ` · ${health.backend}` : ''}.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={busy}
        >
          Refresh
        </Button>
      </header>

      {loadError ? <FieldError>{loadError}</FieldError> : null}

      {canProvision ? (
        <form
          noValidate
          className="flex max-w-lg flex-col gap-3 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => {
              const formDisabled = busy || isSubmitting;
              return (
                <FieldGroup className="gap-3">
                  <form.Field name="address">
                    {(field) => {
                      const invalid = isFieldInvalid(field.state.meta);
                      return (
                        <Field data-invalid={invalid || undefined}>
                          <FieldLabel htmlFor="addr">Address</FieldLabel>
                          <Input
                            id="addr"
                            name={field.name}
                            type="email"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(e) => {
                              field.handleChange(e.target.value);
                              if (submitError) setSubmitError(null);
                            }}
                            placeholder="coi@inbound.example.com"
                            disabled={formDisabled}
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
                  <form.Field name="purpose">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="purpose">
                          Purpose (optional)
                        </FieldLabel>
                        <Input
                          id="purpose"
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            field.handleChange(e.target.value);
                            if (submitError) setSubmitError(null);
                          }}
                          placeholder="coi"
                          disabled={formDisabled}
                        />
                      </Field>
                    )}
                  </form.Field>
                  {submitError ? <FieldError>{submitError}</FieldError> : null}
                  <Button type="submit" disabled={formDisabled}>
                    {isSubmitting ? 'Provisioning…' : 'Provision'}
                  </Button>
                </FieldGroup>
              );
            }}
          </form.Subscribe>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Provisioning requires <code>email.send</code>.
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Address</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {addresses.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                No addresses for this org.
              </TableCell>
            </TableRow>
          ) : (
            addresses.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {row.address}
                </TableCell>
                <TableCell>{row.purpose ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}
