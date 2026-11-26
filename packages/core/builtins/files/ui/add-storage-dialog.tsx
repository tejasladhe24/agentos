import { useEffect, useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
  useHostApi,
  useHostNotifications,
} from '@agentos/core/client';
import { CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { Checkbox } from '@agentos/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentos/ui/components/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@agentos/ui/components/radio-group';

import {
  parseErrorBody,
  type StorageProviderField,
  type StorageProviderInfo,
  type StorageProviderPreset,
} from './files-types';
import { MountIcon } from './mount-icon';

type Step = 'provider' | 'form';

type Choice = { provider: StorageProviderInfo; preset?: StorageProviderPreset };

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok' }
  | { status: 'failed'; message: string };

type AddStorageFormValues = {
  name: string;
  values: Record<string, string>;
  makeDefault: boolean;
};

export type AddStorageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: StorageProviderInfo[];
  onAdded: () => Promise<void> | void;
};

function choiceId(
  provider: StorageProviderInfo,
  preset?: StorageProviderPreset,
) {
  return preset ? `${provider.id}:${preset.id}` : provider.id;
}

/** Fields shown for a provider + preset (secrets always shown). */
export function visibleFields(
  provider: StorageProviderInfo,
  preset?: StorageProviderPreset,
): StorageProviderField[] {
  const fields = provider.fields ?? [];
  if (!preset?.fields) return fields;
  const allowed = new Set(preset.fields);
  return fields.filter((f) => f.type === 'secret' || allowed.has(f.id));
}

function createAddStorageSchema(
  fields: StorageProviderField[],
  required: Set<string>,
) {
  return z
    .object({
      name: z.string().trim().min(1, 'Name is required'),
      values: z.record(z.string(), z.string()),
      makeDefault: z.boolean(),
    })
    .superRefine((data, ctx) => {
      for (const field of fields) {
        if (required.has(field.id) && !(data.values[field.id] ?? '').trim()) {
          ctx.addIssue({
            code: 'custom',
            message: `${field.label} is required`,
            path: ['values', field.id],
          });
        }
      }
    });
}

/** Settings › Files › Add storage: pick provider / preset → form → test → add. */
export function AddStorageDialog({
  open,
  onOpenChange,
  providers,
  onAdded,
}: AddStorageDialogProps) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const choices = useMemo<Choice[]>(
    () =>
      providers.flatMap((provider): Choice[] =>
        provider.presets?.length
          ? provider.presets.map((preset) => ({ provider, preset }))
          : [{ provider }],
      ),
    [providers],
  );
  const [step, setStep] = useState<Step>('provider');
  const [choice, setChoice] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const selected = choices.find(
    (c) => choiceId(c.provider, c.preset) === choice,
  );
  const fields = useMemo(
    () => (selected ? visibleFields(selected.provider, selected.preset) : []),
    [selected],
  );
  const required = useMemo(
    () =>
      new Set(
        selected?.preset?.required ??
          fields.filter((f) => f.required).map((f) => f.id),
      ),
    [selected, fields],
  );
  const schema = useMemo(
    () => createAddStorageSchema(fields, required),
    [fields, required],
  );

  function buildPayload(values: Record<string, string>) {
    if (!selected) return null;
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    if (selected.preset) config.preset = selected.preset.id;
    for (const field of fields) {
      const value = (
        values[field.id] ??
        field.options?.[0]?.value ??
        ''
      ).trim();
      if (!value) continue;
      if (field.type === 'secret') secrets[field.id] = value;
      else config[field.id] = value;
    }
    return { provider: selected.provider.id, config, secrets };
  }

  const form = useForm({
    defaultValues: {
      name: '',
      values: {},
      makeDefault: false,
    } as AddStorageFormValues,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const body = buildPayload(value.values);
      if (!body) return;
      setError(null);
      const res = await api.fetch('/mounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          name: value.name.trim(),
          isDefault: value.makeDefault,
        }),
      });
      if (!res.ok) {
        const message = parseErrorBody(res.body, 'Could not add storage');
        setError(message);
        await notifications.show(message, 'error');
        return;
      }
      await notifications.show(`${value.name.trim()} connected`, 'info');
      onOpenChange(false);
      await onAdded();
    },
  });

  useEffect(() => {
    if (!open) return;
    setStep('provider');
    setChoice(
      choices[0] ? choiceId(choices[0].provider, choices[0].preset) : '',
    );
    form.reset({ name: '', values: {}, makeDefault: false });
    setTest({ status: 'idle' });
    setError(null);
  }, [open, choices, form]);

  async function runTest() {
    const body = buildPayload(form.state.values.values);
    if (!body) return;
    setTest({ status: 'running' });
    const res = await api.fetch('/mounts/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setTest({
        status: 'failed',
        message: parseErrorBody(res.body, 'Connection test failed'),
      });
      return;
    }
    const result = JSON.parse(res.body) as { ok?: boolean; error?: string };
    setTest(
      result.ok
        ? { status: 'ok' }
        : { status: 'failed', message: result.error ?? 'Connection failed' },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        data-slot="files-add-storage-dialog"
      >
        <DialogHeader>
          <DialogTitle>Add storage</DialogTitle>
          {step === 'form' && selected ? (
            <DialogDescription>
              {selected.preset?.help ?? selected.provider.label}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {choices.length === 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              No storage providers are available to connect yet. Platform
              storage is configured by the deployment.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : step === 'provider' ? (
          <>
            <RadioGroup
              value={choice}
              onValueChange={(v) => setChoice(String(v))}
              aria-label="Storage service"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              data-slot="files-storage-presets"
            >
              {choices.map(({ provider, preset }) => {
                const id = choiceId(provider, preset);
                return (
                  <FieldLabel key={id} htmlFor={`files-add-${id}`}>
                    <Field orientation="horizontal">
                      <MountIcon
                        provider={provider.id}
                        className="size-4 shrink-0"
                      />
                      <FieldContent>
                        <FieldTitle>
                          {preset?.label ?? provider.label}
                        </FieldTitle>
                      </FieldContent>
                      <RadioGroupItem value={id} id={`files-add-${id}`} />
                    </Field>
                  </FieldLabel>
                );
              })}
            </RadioGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!selected}
                onClick={() => {
                  form.reset({
                    name: selected?.preset?.label ?? '',
                    values: {},
                    makeDefault: false,
                  });
                  setTest({ status: 'idle' });
                  setError(null);
                  setStep('form');
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Subscribe
              selector={(state) => ({
                isSubmitting: state.isSubmitting,
                values: state.values.values,
              })}
            >
              {({ isSubmitting, values }) => {
                const missingRequired = fields.some(
                  (f) => required.has(f.id) && !values[f.id]?.trim(),
                );
                return (
                  <>
                    <FieldGroup className="gap-3">
                      <form.Field name="name">
                        {(field) => {
                          const invalid = isFieldInvalid(field.state.meta);
                          return (
                            <Field data-invalid={invalid || undefined}>
                              <FieldLabel htmlFor="files-add-name">
                                Name
                              </FieldLabel>
                              <Input
                                id="files-add-name"
                                name={field.name}
                                value={field.state.value}
                                placeholder={
                                  selected?.preset?.label ?? 'Storage name'
                                }
                                onBlur={field.handleBlur}
                                onChange={(e) => {
                                  field.handleChange(e.target.value);
                                  if (error) setError(null);
                                }}
                                disabled={isSubmitting}
                                aria-invalid={invalid || undefined}
                              />
                              {invalid ? (
                                <FieldError
                                  errors={toFieldErrors(
                                    field.state.meta.errors,
                                  )}
                                />
                              ) : null}
                            </Field>
                          );
                        }}
                      </form.Field>
                      {fields.map((fieldSpec) => (
                        <form.Field
                          key={fieldSpec.id}
                          name={`values.${fieldSpec.id}` as never}
                        >
                          {(field) => {
                            const invalid = isFieldInvalid(field.state.meta);
                            const currentVal =
                              (field.state.value as string | undefined) ??
                              fieldSpec.options?.[0]?.value ??
                              '';
                            return fieldSpec.type === 'choice' ? (
                              <Field data-invalid={invalid || undefined}>
                                <FieldLabel>{fieldSpec.label}</FieldLabel>
                                <RadioGroup
                                  value={currentVal}
                                  onValueChange={(v) => {
                                    field.handleChange(String(v) as never);
                                    setTest({ status: 'idle' });
                                    if (error) setError(null);
                                  }}
                                  aria-label={fieldSpec.label}
                                >
                                  {(fieldSpec.options ?? []).map((option) => (
                                    <Field
                                      key={option.value}
                                      orientation="horizontal"
                                    >
                                      <RadioGroupItem
                                        value={option.value}
                                        id={`files-add-field-${fieldSpec.id}-${option.value}`}
                                      />
                                      <FieldLabel
                                        htmlFor={`files-add-field-${fieldSpec.id}-${option.value}`}
                                      >
                                        {option.label}
                                      </FieldLabel>
                                    </Field>
                                  ))}
                                </RadioGroup>
                                {fieldSpec.help ? (
                                  <FieldDescription>
                                    {fieldSpec.help}
                                  </FieldDescription>
                                ) : null}
                                {invalid ? (
                                  <FieldError
                                    errors={toFieldErrors(
                                      field.state.meta.errors,
                                    )}
                                  />
                                ) : null}
                              </Field>
                            ) : (
                              <Field data-invalid={invalid || undefined}>
                                <FieldLabel
                                  htmlFor={`files-add-field-${fieldSpec.id}`}
                                >
                                  {fieldSpec.label}
                                  {required.has(fieldSpec.id) ? ' *' : ''}
                                </FieldLabel>
                                <Input
                                  id={`files-add-field-${fieldSpec.id}`}
                                  name={field.name}
                                  type={
                                    fieldSpec.type === 'secret'
                                      ? 'password'
                                      : 'text'
                                  }
                                  autoComplete="off"
                                  placeholder={fieldSpec.placeholder}
                                  value={
                                    (field.state.value as string | undefined) ??
                                    ''
                                  }
                                  onBlur={field.handleBlur}
                                  onChange={(e) => {
                                    field.handleChange(e.target.value as never);
                                    setTest({ status: 'idle' });
                                    if (error) setError(null);
                                  }}
                                  disabled={isSubmitting}
                                  aria-invalid={invalid || undefined}
                                />
                                {fieldSpec.help ? (
                                  <FieldDescription>
                                    {fieldSpec.help}
                                  </FieldDescription>
                                ) : null}
                                {invalid ? (
                                  <FieldError
                                    errors={toFieldErrors(
                                      field.state.meta.errors,
                                    )}
                                  />
                                ) : null}
                              </Field>
                            );
                          }}
                        </form.Field>
                      ))}
                      <form.Field name="makeDefault">
                        {(field) => (
                          <Field orientation="horizontal">
                            <Checkbox
                              id="files-add-default"
                              checked={field.state.value}
                              disabled={isSubmitting}
                              onCheckedChange={(checked) =>
                                field.handleChange(checked === true)
                              }
                            />
                            <FieldLabel htmlFor="files-add-default">
                              Use as default storage for new uploads
                            </FieldLabel>
                          </Field>
                        )}
                      </form.Field>
                      {test.status === 'ok' ? (
                        <p
                          className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
                          data-slot="files-add-test-ok"
                        >
                          <CheckCircleIcon className="size-4" aria-hidden />
                          Connection works: list, upload, and delete succeeded.
                        </p>
                      ) : test.status === 'failed' ? (
                        <FieldError data-slot="files-add-test-error">
                          <span className="flex items-center gap-1.5">
                            <WarningCircleIcon
                              className="size-4 shrink-0"
                              aria-hidden
                            />
                            {test.message}
                          </span>
                        </FieldError>
                      ) : null}
                      {error ? <FieldError>{error}</FieldError> : null}
                    </FieldGroup>

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={isSubmitting}
                        onClick={() => setStep('provider')}
                      >
                        Back
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          isSubmitting ||
                          missingRequired ||
                          test.status === 'running'
                        }
                        onClick={() => void runTest()}
                      >
                        {test.status === 'running'
                          ? 'Testing…'
                          : 'Test connection'}
                      </Button>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? 'Adding…' : 'Add storage'}
                      </Button>
                    </DialogFooter>
                  </>
                );
              }}
            </form.Subscribe>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
