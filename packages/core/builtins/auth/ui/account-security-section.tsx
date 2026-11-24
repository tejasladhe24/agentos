import { useState, type SubmitEvent } from 'react';
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

export type AccountSecuritySectionProps = {
  busy?: boolean;
  onChangePassword: (input: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<void>;
};

export function AccountSecuritySection({
  busy = false,
  onChangePassword,
}: AccountSecuritySectionProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      setError('Current and new password are required');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onChangePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to change password',
      );
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;
  const invalid = Boolean(error);

  return (
    <form onSubmit={onSubmit} data-slot="account-security">
      <FieldSet data-setting-entry="change-password">
        <FieldLegend>Security</FieldLegend>
        <FieldDescription>
          Change your password while signed in.
        </FieldDescription>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="account-current-password">
                Current password
              </FieldLabel>
              <FieldDescription>
                Verify your existing password first.
              </FieldDescription>
            </FieldContent>
            <Input
              id="account-current-password"
              type="password"
              value={currentPassword}
              onValueChange={(v) => {
                setCurrentPassword(v);
                if (error) setError(null);
              }}
              disabled={disabled}
              autoComplete="current-password"
              required
              className="sm:max-w-60"
            />
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="account-new-password">
                New password
              </FieldLabel>
              <FieldDescription>
                Choose a strong password you don&apos;t reuse elsewhere.
              </FieldDescription>
            </FieldContent>
            <Input
              id="account-new-password"
              type="password"
              value={newPassword}
              onValueChange={(v) => {
                setNewPassword(v);
                if (error) setError(null);
              }}
              disabled={disabled}
              autoComplete="new-password"
              required
              className="sm:max-w-60"
            />
          </Field>

          <Field orientation="responsive" data-invalid={invalid || undefined}>
            <FieldContent>
              <FieldLabel htmlFor="account-confirm-password">
                Confirm password
              </FieldLabel>
              <FieldDescription>
                Re-enter your new password to confirm.
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldContent>
            <Input
              id="account-confirm-password"
              type="password"
              value={confirm}
              onValueChange={(v) => {
                setConfirm(v);
                if (error) setError(null);
              }}
              disabled={disabled}
              aria-invalid={invalid || undefined}
              autoComplete="new-password"
              required
              className="sm:max-w-60"
            />
          </Field>

          <Field orientation="horizontal" className="justify-end">
            <Button type="submit" size="sm" disabled={disabled}>
              {saving ? 'Updating…' : 'Update password'}
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
