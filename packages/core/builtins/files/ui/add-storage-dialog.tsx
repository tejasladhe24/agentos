import { useEffect, useMemo, useState } from 'react';
import { useHostApi, useHostNotifications } from '@agentos/core/client';
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
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [makeDefault, setMakeDefault] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('provider');
    setChoice(
      choices[0] ? choiceId(choices[0].provider, choices[0].preset) : '',
    );
    setName('');
    setValues({});
    setMakeDefault(false);
    setTest({ status: 'idle' });
    setError(null);
  }, [open, choices]);

  const selected = choices.find(
    (c) => choiceId(c.provider, c.preset) === choice,
  );
  const fields = selected
    ? visibleFields(selected.provider, selected.preset)
    : [];
  const required = new Set(selected?.preset?.required ?? []);

  function payload() {
    if (!selected) return null;
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    if (selected.preset) config.preset = selected.preset.id;
    for (const field of fields) {
      const value = values[field.id]?.trim();
      if (!value) continue;
      if (field.type === 'secret') secrets[field.id] = value;
      else config[field.id] = value;
    }
    return { provider: selected.provider.id, config, secrets };
  }

  async function runTest() {
    const body = payload();
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

  async function submit() {
    const body = payload();
    if (!body || !name.trim()) return;
    setSaving(true);
    setError(null);
    const res = await api.fetch('/mounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        name: name.trim(),
        isDefault: makeDefault,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(parseErrorBody(res.body, 'Could not add storage'));
      return;
    }
    await notifications.show(`${name.trim()} connected`, 'info');
    onOpenChange(false);
    await onAdded();
  }

  const missingRequired = fields.some(
    (f) => required.has(f.id) && !values[f.id]?.trim(),
  );

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
          <p className="text-sm text-muted-foreground">
            No storage providers are available to connect yet. Platform storage
            is configured by the deployment.
          </p>
        ) : step === 'provider' ? (
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
                      <FieldTitle>{preset?.label ?? provider.label}</FieldTitle>
                    </FieldContent>
                    <RadioGroupItem value={id} id={`files-add-${id}`} />
                  </Field>
                </FieldLabel>
              );
            })}
          </RadioGroup>
        ) : (
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="files-add-name">Name</FieldLabel>
              <Input
                id="files-add-name"
                value={name}
                placeholder={selected?.preset?.label ?? 'Storage name'}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {fields.map((field) => (
              <Field key={field.id}>
                <FieldLabel htmlFor={`files-add-field-${field.id}`}>
                  {field.label}
                  {required.has(field.id) ? ' *' : ''}
                </FieldLabel>
                <Input
                  id={`files-add-field-${field.id}`}
                  type={field.type === 'secret' ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={field.placeholder}
                  value={values[field.id] ?? ''}
                  onChange={(e) => {
                    const next = e.target.value;
                    setValues((prev) => ({ ...prev, [field.id]: next }));
                    setTest({ status: 'idle' });
                  }}
                />
                {field.help ? (
                  <FieldDescription>{field.help}</FieldDescription>
                ) : null}
              </Field>
            ))}
            <Field orientation="horizontal">
              <Checkbox
                id="files-add-default"
                checked={makeDefault}
                onCheckedChange={(checked) => setMakeDefault(checked === true)}
              />
              <FieldLabel htmlFor="files-add-default">
                Use as default storage for new uploads
              </FieldLabel>
            </Field>
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
                  <WarningCircleIcon className="size-4 shrink-0" aria-hidden />
                  {test.message}
                </span>
              </FieldError>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        )}

        <DialogFooter>
          {step === 'form' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('provider')}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={missingRequired || test.status === 'running'}
                onClick={() => void runTest()}
              >
                {test.status === 'running' ? 'Testing…' : 'Test connection'}
              </Button>
              <Button
                type="button"
                disabled={saving || missingRequired || !name.trim()}
                onClick={() => void submit()}
              >
                {saving ? 'Adding…' : 'Add storage'}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              {choices.length ? (
                <Button
                  type="button"
                  disabled={!selected}
                  onClick={() => {
                    setName(selected?.preset?.label ?? '');
                    setStep('form');
                  }}
                >
                  Continue
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
