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
import { navigateApp, requestPasswordReset } from '@agentos/core/shell/lib';
import { AuthFormCard, AuthFormPanel } from './auth-form-card';
import { AuthPublicLayout } from './auth-public-layout';

const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});

export type ForgotPasswordPageBranding = {
  appName: string;
  logoUrl?: string;
};

export type ForgotPasswordPageProps = {
  branding?: ForgotPasswordPageBranding;
};

export function ForgotPasswordPage({
  branding = { appName: 'AgentOS' },
}: ForgotPasswordPageProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm({
    defaultValues: {
      email: '',
    },
    validators: {
      onSubmit: forgotPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await requestPasswordReset(value.email.trim());
        setDone(true);
      } catch (err) {
        setSubmitError(
          err instanceof Error
            ? err.message
            : 'Could not request password reset',
        );
      }
    },
  });

  return (
    <AuthPublicLayout>
      <AuthFormCard appName={branding.appName} logoUrl={branding.logoUrl}>
        <AuthFormPanel>
          {done ? (
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Check your email</h1>
                <p className="text-balance text-muted-foreground">
                  If that address exists, a reset link was sent. In local dev,
                  check the auth server logs for the URL.
                </p>
              </div>
              <Field>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => navigateApp('/login')}
                >
                  Back to login
                </Button>
              </Field>
            </FieldGroup>
          ) : (
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
                  <h1 className="text-2xl font-bold">Forgot password</h1>
                  <p className="text-balance text-muted-foreground">
                    Enter your email and we&apos;ll send a reset link
                  </p>
                </div>
                <form.Field name="email">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
                        <Input
                          id="forgot-email"
                          name={field.name}
                          type="email"
                          autoComplete="username"
                          placeholder="m@example.com"
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
                        {isSubmitting ? 'Sending…' : 'Send reset link'}
                      </Button>
                    </Field>
                  )}
                </form.Subscribe>
                <FieldDescription className="text-center">
                  Remembered it?{' '}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0"
                    onClick={() => navigateApp('/login')}
                  >
                    Login
                  </Button>
                </FieldDescription>
              </FieldGroup>
            </form>
          )}
        </AuthFormPanel>
      </AuthFormCard>
    </AuthPublicLayout>
  );
}
