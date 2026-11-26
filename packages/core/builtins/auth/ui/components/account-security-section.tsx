import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
} from '@agentos/core/client/lib/form-errors';
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

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters'),
    confirm: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

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
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirm: '',
    },
    validators: {
      onSubmit: changePasswordSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await onChangePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
        });
        form.reset();
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to change password',
        );
      }
    },
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      data-slot="account-security"
    >
      <FieldSet data-setting-entry="change-password">
        <FieldLegend>Security</FieldLegend>
        <FieldDescription>
          Change your password while signed in.
        </FieldDescription>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => {
            const disabled = busy || isSubmitting;
            return (
              <FieldGroup>
                <form.Field name="currentPassword">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field
                        orientation="responsive"
                        data-invalid={invalid || undefined}
                      >
                        <FieldContent>
                          <FieldLabel htmlFor="account-current-password">
                            Current password
                          </FieldLabel>
                          <FieldDescription>
                            Verify your existing password first.
                          </FieldDescription>
                          {invalid ? (
                            <FieldError
                              errors={toFieldErrors(field.state.meta.errors)}
                            />
                          ) : null}
                        </FieldContent>
                        <Input
                          id="account-current-password"
                          name={field.name}
                          type="password"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onValueChange={(value) => {
                            field.handleChange(value);
                            if (submitError) setSubmitError(null);
                          }}
                          disabled={disabled}
                          aria-invalid={invalid || undefined}
                          autoComplete="current-password"
                          className="sm:max-w-60"
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="newPassword">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field
                        orientation="responsive"
                        data-invalid={invalid || undefined}
                      >
                        <FieldContent>
                          <FieldLabel htmlFor="account-new-password">
                            New password
                          </FieldLabel>
                          <FieldDescription>
                            Choose a strong password you don&apos;t reuse
                            elsewhere.
                          </FieldDescription>
                          {invalid ? (
                            <FieldError
                              errors={toFieldErrors(field.state.meta.errors)}
                            />
                          ) : null}
                        </FieldContent>
                        <Input
                          id="account-new-password"
                          name={field.name}
                          type="password"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onValueChange={(value) => {
                            field.handleChange(value);
                            if (submitError) setSubmitError(null);
                          }}
                          disabled={disabled}
                          aria-invalid={invalid || undefined}
                          autoComplete="new-password"
                          className="sm:max-w-60"
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                <form.Field name="confirm">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field
                        orientation="responsive"
                        data-invalid={invalid || undefined}
                      >
                        <FieldContent>
                          <FieldLabel htmlFor="account-confirm-password">
                            Confirm password
                          </FieldLabel>
                          <FieldDescription>
                            Re-enter your new password to confirm.
                          </FieldDescription>
                          {invalid ? (
                            <FieldError
                              errors={toFieldErrors(field.state.meta.errors)}
                            />
                          ) : null}
                        </FieldContent>
                        <Input
                          id="account-confirm-password"
                          name={field.name}
                          type="password"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onValueChange={(value) => {
                            field.handleChange(value);
                            if (submitError) setSubmitError(null);
                          }}
                          disabled={disabled}
                          aria-invalid={invalid || undefined}
                          autoComplete="new-password"
                          className="sm:max-w-60"
                        />
                      </Field>
                    );
                  }}
                </form.Field>

                {submitError ? <FieldError>{submitError}</FieldError> : null}

                <Field orientation="horizontal" className="justify-end">
                  <Button type="submit" size="sm" disabled={disabled}>
                    {isSubmitting ? 'Updating…' : 'Update password'}
                  </Button>
                </Field>
              </FieldGroup>
            );
          }}
        </form.Subscribe>
      </FieldSet>
    </form>
  );
}
