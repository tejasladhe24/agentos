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
import { navigateApp, signUpWithEmail } from '@agentos/core/shell/lib';
import { AuthFormCard, AuthFormPanel } from './auth-form-card';
import { AuthPublicLayout } from './auth-public-layout';

const registerSchema = z.object({
  name: z.string(),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type RegisterPageBranding = {
  appName: string;
  logoUrl?: string;
};

export type RegisterPageProps = {
  afterSignInPath: string;
  branding?: RegisterPageBranding;
};

export function RegisterPage({
  afterSignInPath,
  branding = { appName: 'AgentOS' },
}: RegisterPageProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
    validators: {
      onSubmit: registerSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await signUpWithEmail({
          email: value.email.trim(),
          password: value.password,
          name: value.name.trim() || undefined,
        });
        navigateApp(afterSignInPath);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Sign-up failed');
      }
    },
  });

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
                <h1 className="text-2xl font-bold">Create an account</h1>
                <p className="text-balance text-muted-foreground">
                  Register with email and password
                </p>
              </div>
              <form.Field name="name">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="register-name">Name</FieldLabel>
                      <Input
                        id="register-name"
                        name={field.name}
                        type="text"
                        autoComplete="name"
                        placeholder="Jane Doe"
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
              <form.Field name="email">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="register-email">Email</FieldLabel>
                      <Input
                        id="register-email"
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
              <form.Field name="password">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="register-password">
                        Password
                      </FieldLabel>
                      <Input
                        id="register-password"
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
                      {isSubmitting ? 'Creating…' : 'Create account'}
                    </Button>
                  </Field>
                )}
              </form.Subscribe>
              <FieldDescription className="text-center">
                Already have an account?{' '}
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
        </AuthFormPanel>
      </AuthFormCard>
    </AuthPublicLayout>
  );
}
