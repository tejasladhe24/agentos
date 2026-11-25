import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
import { Button } from '@agentos/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@agentos/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import { LoadingState } from '@agentos/ui/components/loading-state';

export const USER_EMAIL_PREFS_PATH = '/api/ext/notifications/preferences/email';

export type UserEmailFromData = {
  from: string | null;
  orgFrom: string | null;
};

function parseError(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
  } catch {
    // non-JSON body
  }
  return fallback;
}

export type UserEmailFromCardViewProps = {
  value: string;
  savedFrom: string | null;
  orgFrom: string | null;
  busy?: boolean;
  error?: string | null;
  entryId?: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
};

/** Presentational personal sender address card (SSR / test friendly). */
export function UserEmailFromCardView({
  value,
  savedFrom,
  orgFrom,
  busy = false,
  error = null,
  entryId,
  onChange,
  onSave,
  onClear,
}: UserEmailFromCardViewProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave();
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card data-slot="user-email-from-card" data-setting-entry={entryId}>
        <CardHeader>
          <CardTitle>Your sender address</CardTitle>
          <CardDescription>
            Choose the From address used when you send email through your
            organization&apos;s email provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="user-email-from">From address</FieldLabel>
            <Input
              id="user-email-from"
              value={value}
              placeholder={orgFrom || 'Jane Doe <jane@acme.com>'}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              onChange={(e) => onChange(e.target.value)}
            />
            <FieldDescription>
              Must use a domain verified on your organization&apos;s email
              provider.
              {orgFrom
                ? ` Leave blank to use the organization default (${orgFrom}).`
                : ' Leave blank to use the organization default.'}
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </CardContent>
        <CardFooter className="gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          {savedFrom ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onClear}
            >
              Use organization default
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </form>
  );
}

/** Self-loading per-user email sender address card for Settings → Email. */
export function UserEmailFromCard({ entryId }: { entryId?: string }) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [data, setData] = useState<UserEmailFromData | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.fetch(USER_EMAIL_PREFS_PATH);
    setLoading(false);
    if (!res.ok) {
      setError(parseError(res.body, 'Could not load sender address.'));
      return;
    }
    try {
      const parsed = JSON.parse(res.body) as UserEmailFromData;
      setData(parsed);
      setValue(parsed.from ?? '');
      setError(null);
    } catch {
      setError('Invalid sender preference response.');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(nextFrom: string | null) {
    setBusy(true);
    setError(null);
    const res = await api.fetch(USER_EMAIL_PREFS_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: nextFrom }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(parseError(res.body, 'Could not save sender address.'));
      return;
    }
    try {
      const parsed = JSON.parse(res.body) as UserEmailFromData;
      setData(parsed);
      setValue(parsed.from ?? '');
    } catch {
      await load();
    }
    await notifications.show(
      nextFrom ? 'Sender address saved' : 'Reset to organization default',
      'info',
    );
  }

  if (loading) return <LoadingState size="sm">Loading…</LoadingState>;

  return (
    <UserEmailFromCardView
      value={value}
      savedFrom={data?.from ?? null}
      orgFrom={data?.orgFrom ?? null}
      busy={busy}
      error={error}
      entryId={entryId}
      onChange={(next) => {
        setValue(next);
        if (error) setError(null);
      }}
      onSave={() => void save(value.trim() || null)}
      onClear={() => void save(null)}
    />
  );
}
