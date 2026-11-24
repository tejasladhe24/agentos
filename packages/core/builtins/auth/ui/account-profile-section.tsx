import { useEffect, useState, type SubmitEvent } from 'react';
import { Button } from '@agentos/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';

export type AccountProfileSectionProps = {
  email: string;
  name: string;
  busy?: boolean;
  onSaveName: (name: string) => Promise<void>;
};

export function AccountProfileSection({
  email,
  name,
  busy = false,
  onSaveName,
}: AccountProfileSectionProps) {
  const [draftName, setDraftName] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftName(name);
  }, [name]);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draftName.trim();
    if (!next) {
      setError('Name is required');
      return;
    }
    if (next === name) {
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSaveName(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update name');
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;
  const invalid = Boolean(error);

  return (
    <form onSubmit={onSubmit} data-slot="account-profile">
      <FieldSet>
        <FieldLegend>Profile</FieldLegend>
        <FieldDescription>
          Your account identity across this workspace.
        </FieldDescription>
        <FieldGroup>
          <Field orientation="responsive" data-setting-entry="email">
            <FieldContent>
              <FieldLabel htmlFor="account-email">Email</FieldLabel>
              <FieldDescription>
                Used to sign in and receive workspace notifications.
              </FieldDescription>
            </FieldContent>
            <Input
              id="account-email"
              type="email"
              value={email}
              disabled
              readOnly
              autoComplete="username"
              className="sm:max-w-60"
            />
          </Field>

          <Field
            orientation="responsive"
            data-setting-entry="display-name"
            data-invalid={invalid || undefined}
          >
            <FieldContent>
              <FieldLabel htmlFor="account-name">Display name</FieldLabel>
              <FieldDescription>
                Shown to teammates in activity logs and organizations.
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldContent>
            <Input
              id="account-name"
              type="text"
              value={draftName}
              onValueChange={(v) => {
                setDraftName(v);
                if (error) setError(null);
              }}
              disabled={disabled}
              aria-invalid={invalid || undefined}
              autoComplete="name"
              required
              className="sm:max-w-60"
            />
          </Field>

          <Field orientation="horizontal" className="justify-end">
            <Button type="submit" size="sm" disabled={disabled}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
