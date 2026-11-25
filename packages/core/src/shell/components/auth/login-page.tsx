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
  readNextParam,
  signInWithEmail,
} from '@agentos/core/shell/lib';
import { AuthFormCard, AuthFormPanel } from './auth-form-card';
import { AuthPublicLayout } from './auth-public-layout';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginPageBranding = {
  appName: string;
  logoUrl?: string;
};

export type LoginPageProps = {
  allowSignUp: boolean;
  allowPasswordReset: boolean;
  afterSignInPath: string;
  search?: string;
  branding?: LoginPageBranding;
};

export function LoginPage({
  allowSignUp,
  allowPasswordReset,
  afterSignInPath,
  search = typeof window !== 'undefined' ? window.location.search : '',
  branding = { appName: 'AgentOS' },
}: LoginPageProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: 'admin@example.com',
      password: 'password123',
    },
    validators: {
      onSubmit: loginSchema,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await signInWithEmail(value.email.trim(), value.password);
        const next = readNextParam(search) ?? afterSignInPath;
        navigateApp(next);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Sign-in failed');
      }
    },
  });

  return (
    <AuthPublicLayout>
      <AuthFormCard
        appName={branding.appName}
        logoUrl={branding.logoUrl}
        footer={
          <>
            By continuing, you agree to the workspace terms for this{' '}
            {branding.appName} deployment.
          </>
        }
      >
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
                <h1 className="text-2xl font-bold">Welcome back</h1>
                <p className="text-balance text-muted-foreground">
                  Login to your {branding.appName} account
                </p>
              </div>
              <form.Field name="email">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <Field data-invalid={invalid || undefined}>
                      <FieldLabel htmlFor="login-email">Email</FieldLabel>
                      <Input
                        id="login-email"
                        name={field.name}
                        type="email"
                        placeholder="m@example.com"
                        autoComplete="username"
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
                      <div className="flex items-center">
                        <FieldLabel htmlFor="login-password">
                          Password
                        </FieldLabel>
                        {allowPasswordReset ? (
                          <Button
                            type="button"
                            variant="link"
                            className="ml-auto h-auto px-0 text-sm"
                            onClick={() => navigateApp('/forgot-password')}
                          >
                            Forgot your password?
                          </Button>
                        ) : null}
                      </div>
                      <Input
                        id="login-password"
                        name={field.name}
                        type="password"
                        autoComplete="current-password"
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
                      {isSubmitting ? 'Signing in…' : 'Login'}
                    </Button>
                  </Field>
                )}
              </form.Subscribe>
              <FieldDescription className="text-center">
                Demo: admin@example.com / password123
              </FieldDescription>
              {allowSignUp ? (
                <FieldDescription className="text-center">
                  Don&apos;t have an account?{' '}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0"
                    onClick={() => navigateApp('/register')}
                  >
                    Sign up
                  </Button>
                </FieldDescription>
              ) : null}
            </FieldGroup>
          </form>
        </AuthFormPanel>
      </AuthFormCard>
    </AuthPublicLayout>
  );
}
