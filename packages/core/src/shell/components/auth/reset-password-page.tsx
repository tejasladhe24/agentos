import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Button } from '@agentos/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import {
  isFieldInvalid,
  toFieldErrors,
} from '@agentos/core/client/lib/form-errors';
import {
  navigateApp,
  readResetToken,
  resetPasswordWithToken,
} from '@agentos/core/shell/lib';
import { AuthFormCard, AuthFormPanel } from './auth-form-card';
import { AuthPublicLayout } from './auth-public-layout';

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export type ResetPasswordPageBranding = {
  appName: string;
  logoUrl?: string;
};

export type ResetPasswordPageProps = {
  search?: string;
  branding?: ResetPasswordPageBranding;
};

export function ResetPasswordPage({
  search = typeof window !== 'undefined' ? window.location.search : '',
  branding = { appName: 'AgentOS' },
}: ResetPasswordPageProps) {
  const token = readResetToken(search);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      password: '',
      confirm: '',
    },
    validators: {
      onSubmit: resetPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      if (!token) {
        setSubmitError('Missing reset token');
        return;
      }
      setSubmitError(null);
      try {
        await resetPasswordWithToken(token, value.password);
        navigateApp('/login');
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Reset failed');
      }
    },
  });

  if (!token) {
    return (
      <AuthPublicLayout>
        <AuthFormCard appName={branding.appName} logoUrl={branding.logoUrl}>
          <AuthFormPanel>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Invalid reset link</h1>
                <p className="text-balance text-muted-foreground">
                  This link is missing a token. Request a new one to continue.
                </p>
              </div>
              <Field>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => navigateApp('/forgot-password')}
                >
                  Request a new link
                </Button>
              </Field>
              <FieldDescription className="text-center">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto px-0"
                  onClick={() => navigateApp('/login')}
                >
                  Back to login
                </Button>
              </FieldDescription>
            </FieldGroup>
          </AuthFormPanel>
        </AuthFormCard>
      </AuthPublicLayout>
    );
  }

  return (
    <AuthPublicLayout>
      <AuthFormCard appName={branding.appName} logoUrl={branding.logoUrl}>
        <AuthFormPanel>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Choose a new password</h1>
                <p className="text-balance text-muted-foreground">
                  Enter a new password for your account
                </p>
              </div>
              <form.Field name="password">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="reset-password">
                        New password
                      </FieldLabel>
                      <Input
                        id="reset-password"
                        name={field.name}
                        type="password"
                        autoComplete="new-password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onValueChange={(value) => {
                          field.handleChange(value);
                          if (submitError) setSubmitError(null);
                        }}
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
              <form.Field name="confirm">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="reset-password-confirm">
                        Confirm password
                      </FieldLabel>
                      <Input
                        id="reset-password-confirm"
                        name={field.name}
                        type="password"
                        autoComplete="new-password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onValueChange={(value) => {
                          field.handleChange(value);
                          if (submitError) setSubmitError(null);
                        }}
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
              {submitError ? <FieldError>{submitError}</FieldError> : null}
              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Field>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? 'Saving…' : 'Update password'}
                    </Button>
                  </Field>
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        </AuthFormPanel>
      </AuthFormCard>
    </AuthPublicLayout>
  );
}
