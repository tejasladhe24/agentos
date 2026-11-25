import { useEffect, useRef, useState } from 'react';
import { useHostApi } from '@agentos/core/client';
import { IntegrationTextField } from '@agentos/core/client/components/integration-card';
import type { IntegrationSettingRenderInput } from '@agentos/core/client/components/integration-section';
import { Button } from '@agentos/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentos/ui/components/select';

export type AiModelCatalog = {
  language: string[];
  embedding: string[];
  image: string[];
};

export type AiModelKind = keyof AiModelCatalog;

const NONE = '__none__';
const CUSTOM = '__custom__';

/**
 * Model picker: a select over the provider's model list when it is loaded,
 * with "Other model id…" for ids the list does not include. Falls back to a
 * plain text field without a list.
 */
export function AiModelField({
  options,
  ...input
}: IntegrationSettingRenderInput & { options?: string[] }) {
  const { id, field, value, onValueChange, onBlur, disabled, errors } = input;
  const [custom, setCustom] = useState(false);
  const invalid = Boolean(errors?.length);

  if (!options || options.length === 0) {
    return (
      <IntegrationTextField
        id={id}
        field={field}
        value={value}
        disabled={disabled}
        errors={errors}
        onBlur={onBlur}
        onValueChange={onValueChange}
      />
    );
  }

  const ids = value && !options.includes(value) ? [value, ...options] : options;
  const items = [
    ...(field.required ? [] : [{ value: NONE, label: 'None' }]),
    ...ids.map((m) => ({ value: m, label: m })),
    { value: CUSTOM, label: 'Other model id…' },
  ];
  const selected = custom ? CUSTOM : value || (field.required ? null : NONE);

  return (
    <Field
      orientation="responsive"
      data-slot="integration-setting"
      data-invalid={invalid || undefined}
    >
      <FieldContent>
        <FieldLabel htmlFor={id}>
          {field.label}
          {field.required ? null : (
            <span className="text-muted-foreground"> (optional)</span>
          )}
        </FieldLabel>
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
        {invalid ? <FieldError errors={errors} /> : null}
      </FieldContent>
      <div className="flex w-full flex-col gap-2 sm:max-w-60">
        <Select
          items={items}
          value={selected}
          disabled={disabled}
          onValueChange={(next) => {
            if (typeof next !== 'string') return;
            if (next === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onValueChange(next === NONE ? '' : next);
          }}
        >
          <SelectTrigger
            id={id}
            className="w-full"
            aria-invalid={invalid || undefined}
          >
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {custom ? (
          <Input
            aria-label={`${field.label} id`}
            value={value}
            placeholder={field.placeholder ?? 'Model id'}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            onBlur={onBlur}
            onChange={(e) => onValueChange(e.target.value)}
          />
        ) : null}
      </div>
    </Field>
  );
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; count: number }
  | { status: 'error'; message: string };

/**
 * Loads the provider's model list for the selects. Runs automatically when
 * the saved key (or the public AI Gateway catalog) can be used; otherwise
 * after the user enters a key and presses "Load models".
 */
export function AiModelCatalogLoader({
  provider,
  apiKey,
  baseUrl,
  auto,
  onLoaded,
}: {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  auto: boolean;
  onLoaded: (provider: string, catalog: AiModelCatalog) => void;
}) {
  const api = useHostApi();
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const attempted = useRef(new Set<string>());

  const load = async () => {
    setState({ status: 'loading' });
    const res = await api.fetch('/integrations/ai/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider,
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : {}),
      }),
    });
    try {
      const body = JSON.parse(res.body) as {
        models?: AiModelCatalog;
        error?: string;
      };
      if (!res.ok || !body.models) {
        setState({
          status: 'error',
          message: body.error ?? 'Could not load models.',
        });
        return;
      }
      onLoaded(provider, body.models);
      const count =
        body.models.language.length +
        body.models.embedding.length +
        body.models.image.length;
      setState({ status: 'loaded', count });
    } catch {
      setState({ status: 'error', message: 'Could not load models.' });
    }
  };

  useEffect(() => {
    setState({ status: 'idle' });
    if (!auto || attempted.current.has(provider)) return;
    attempted.current.add(provider);
    void load();
  }, [provider, auto]);

  return (
    <Field orientation="horizontal" data-slot="ai-model-catalog">
      <FieldContent>
        <FieldTitle>Model catalog</FieldTitle>
        {state.status === 'loaded' ? (
          <FieldDescription>
            {state.count} models available from the provider.
          </FieldDescription>
        ) : state.status === 'error' ? (
          <FieldError>{state.message}</FieldError>
        ) : (
          <FieldDescription>
            Fetch the provider&apos;s model list to pick from it.
          </FieldDescription>
        )}
      </FieldContent>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={state.status === 'loading'}
        onClick={() => void load()}
      >
        {state.status === 'loading' ? 'Loading models…' : 'Load models'}
      </Button>
    </Field>
  );
}
