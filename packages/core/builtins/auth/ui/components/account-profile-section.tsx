import { useEffect, useState } from 'react';
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

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
});

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
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name },
    validators: {
      onSubmit: profileSchema,
    },
    onSubmit: async ({ value }) => {
      const next = value.name.trim();
      if (next === name) {
        setSubmitError(null);
        return;
      }
      setSubmitError(null);
      try {
        await onSaveName(next);
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to update name',
        );
      }
    },
  });

  useEffect(() => {
    form.reset({ name });
  }, [name, form]);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      data-slot="account-profile"
    >
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

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => {
              const disabled = busy || isSubmitting;
              return (
                <>
                  <form.Field name="name">
                    {(field) => {
                      const fieldInvalid = isFieldInvalid(field.state.meta);
                      const invalid = fieldInvalid || Boolean(submitError);
                      return (
                        <Field
                          orientation="responsive"
                          data-setting-entry="display-name"
                          data-invalid={invalid || undefined}
                        >
                          <FieldContent>
                            <FieldLabel htmlFor="account-name">
                              Display name
                            </FieldLabel>
                            <FieldDescription>
                              Shown to teammates in activity logs and
                              organizations.
                            </FieldDescription>
                            {fieldInvalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : submitError ? (
                              <FieldError>{submitError}</FieldError>
                            ) : null}
                          </FieldContent>
                          <Input
                            id="account-name"
                            name={field.name}
                            type="text"
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={(value) => {
                              field.handleChange(value);
                              if (submitError) setSubmitError(null);
                            }}
                            disabled={disabled}
                            aria-invalid={invalid || undefined}
                            autoComplete="name"
                            className="sm:max-w-60"
                          />
                        </Field>
                      );
                    }}
                  </form.Field>

                  <Field orientation="horizontal" className="justify-end">
                    <Button type="submit" size="sm" disabled={disabled}>
                      {isSubmitting ? 'Saving…' : 'Save changes'}
                    </Button>
                  </Field>
                </>
              );
            }}
          </form.Subscribe>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
