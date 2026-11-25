import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Button } from '@agentos/ui/components/button';
import { FieldDescription, FieldError } from '@agentos/ui/components/field';
import { LoadingState } from '@agentos/ui/components/loading-state';

import {
  isFieldInvalid,
  toFieldErrors,
  type UiFieldError,
} from '../lib/form-errors';
import { useHostApi } from '../lib/use-host-api';
import { useHostNotifications } from '../lib/use-host-notifications';
import {
  IntegrationCard,
  IntegrationProviderPicker,
  IntegrationRemoveButton,
  IntegrationSecretField,
  IntegrationTestButton,
  IntegrationTextField,
  type IntegrationFieldSpec,
  type IntegrationProviderSpec,
  type IntegrationSecretStatus,
  type IntegrationTestOutcome,
} from './integration-card';

/** Shape of `GET <builtin>/integrations/:integration` (see `handleIntegrationRoutes`). */
export type IntegrationSectionData = {
  canManage: boolean;
  definition: {
    id: string;
    label: string;
    description?: string;
    testable: boolean;
    providers: IntegrationProviderSpec[];
  };
  platformDefault: { provider: string; configured: boolean } | null;
  instances: Array<{
    instanceId: string;
    provider: string;
    settings: Record<string, unknown>;
    secrets: Record<string, IntegrationSecretStatus>;
    updatedAt: string;
  }>;
};

export type IntegrationDraft = {
  provider: string;
  settings: Record<string, string>;
  secrets: Record<string, string>;
};

function draftFrom(data: IntegrationSectionData): IntegrationDraft {
  const saved = data.instances[0];
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(saved?.settings ?? {})) {
    if (v !== undefined && v !== null) settings[k] = String(v);
  }
  return {
    provider: saved?.provider ?? data.definition.providers[0]?.id ?? '',
    settings,
    secrets: {},
  };
}

/** Request body for PUT / test: only non-empty secrets are sent. */
export function integrationDraftBody(draft: IntegrationDraft) {
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.secrets)) if (v) secrets[k] = v;
  return { provider: draft.provider, settings: draft.settings, secrets };
}

/**
 * Draft after picking another provider: secrets reset, and settings the new
 * provider does not declare are dropped (the routes reject unknown settings).
 */
export function switchDraftProvider(
  data: IntegrationSectionData,
  draft: IntegrationDraft,
  provider: string,
): IntegrationDraft {
  const accepted = new Set(
    data.definition.providers
      .find((p) => p.id === provider)
      ?.settings.map((f) => f.name) ?? [],
  );
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.settings)) {
    if (accepted.has(k)) settings[k] = v;
  }
  return { provider, settings, secrets: {} };
}

/** Builds a Zod validator from the active provider's required settings & secrets. */
export function createIntegrationDraftSchema(data: IntegrationSectionData) {
  const saved = data.instances[0];
  return z
    .object({
      provider: z.string().min(1, 'Provider is required'),
      settings: z.record(z.string(), z.string()),
      secrets: z.record(z.string(), z.string()),
    })
    .superRefine((draft, ctx) => {
      const provider = data.definition.providers.find(
        (p) => p.id === draft.provider,
      );
      if (!provider) {
        ctx.addIssue({
          code: 'custom',
          message: 'Choose a valid provider',
          path: ['provider'],
        });
        return;
      }
      const sameProvider = saved?.provider === draft.provider;
      for (const field of provider.settings) {
        if (field.required && !(draft.settings[field.name] ?? '').trim()) {
          ctx.addIssue({
            code: 'custom',
            message: `${field.label} is required`,
            path: ['settings', field.name],
          });
        }
      }
      for (const field of provider.secrets) {
        const alreadySet =
          sameProvider && saved?.secrets[field.name]?.set === true;
        if (
          field.required &&
          !alreadySet &&
          !(draft.secrets[field.name] ?? '').trim()
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `${field.label} is required`,
            path: ['secrets', field.name],
          });
        }
      }
    });
}

export type IntegrationSettingRenderInput = {
  id: string;
  field: IntegrationFieldSpec;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  disabled: boolean;
  errors?: UiFieldError[];
  draft: IntegrationDraft;
  data: IntegrationSectionData;
};

/** Builtin-specific additions to the shared integration form. */
export type IntegrationFormExtensions = {
  /** Custom control for one setting; `undefined` keeps the text field. */
  renderSetting?: (input: IntegrationSettingRenderInput) => ReactNode;
  /** Extra content under the fields (hints, loaders, warnings). */
  renderExtra?: (input: {
    draft: IntegrationDraft;
    data: IntegrationSectionData;
  }) => ReactNode;
};

export type IntegrationSettingsFormProps = IntegrationFormExtensions & {
  data: IntegrationSectionData;
  draft: IntegrationDraft;
  onDraftChange: (draft: IntegrationDraft) => void;
  busy?: boolean;
  error?: string | null;
  onSave: (draft?: IntegrationDraft) => Promise<void> | void;
  onRemove: () => Promise<void>;
  onTest: () => Promise<IntegrationTestOutcome>;
  entryId?: string;
};

/** Presentational card for one single-instance integration. */
export function IntegrationSettingsForm({
  data,
  draft,
  onDraftChange,
  busy,
  error,
  onSave,
  onRemove,
  onTest,
  entryId,
  renderSetting,
  renderExtra,
}: IntegrationSettingsFormProps) {
  const saved = data.instances[0];
  const readOnly = !data.canManage;
  const idBase = `integration-${data.definition.id.replace(/\./g, '-')}`;
  const schema = useMemo(() => createIntegrationDraftSchema(data), [data]);

  const form = useForm({
    defaultValues: draft,
    validators: {
      onSubmit: schema,
    },
    onSubmit: async ({ value }) => {
      await onSave(value);
    },
  });

  useEffect(() => {
    form.reset(draft);
  }, [draft, form]);

  const provider = data.definition.providers.find(
    (p) => p.id === draft.provider,
  );
  const sameProvider = saved?.provider === draft.provider;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => {
          const disabled = Boolean(readOnly || busy || isSubmitting);
          return (
            <IntegrationCard
              title={data.definition.label}
              description={data.definition.description}
              source={saved ? 'tenant' : 'platform'}
              platformConfigured={data.platformDefault?.configured ?? true}
              entryId={entryId}
              footer={
                readOnly ? (
                  <FieldDescription>
                    Only admins can change this integration.
                  </FieldDescription>
                ) : (
                  <>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={Boolean(busy || isSubmitting)}
                    >
                      {isSubmitting ? 'Saving…' : 'Save'}
                    </Button>
                    {data.definition.testable ? (
                      <IntegrationTestButton
                        onTest={onTest}
                        disabled={Boolean(busy || isSubmitting)}
                      />
                    ) : null}
                    {saved ? (
                      <span className="ml-auto">
                        <IntegrationRemoveButton
                          name={data.definition.label}
                          onConfirm={onRemove}
                          disabled={Boolean(busy || isSubmitting)}
                        />
                      </span>
                    ) : null}
                  </>
                )
              }
            >
              {!saved && data.platformDefault ? (
                <FieldDescription>
                  {data.platformDefault.configured
                    ? `Using the platform default (${data.platformDefault.provider}) until you add your own key.`
                    : 'No platform default is configured. Add your own provider to enable this integration.'}
                </FieldDescription>
              ) : null}
              <form.Field name="provider">
                {(field) => {
                  const invalid = isFieldInvalid(field.state.meta);
                  return (
                    <IntegrationProviderPicker
                      id={`${idBase}-provider`}
                      providers={data.definition.providers}
                      value={field.state.value}
                      disabled={disabled}
                      errors={
                        invalid
                          ? toFieldErrors(field.state.meta.errors)
                          : undefined
                      }
                      onValueChange={(next) => {
                        const updated = switchDraftProvider(data, draft, next);
                        onDraftChange(updated);
                      }}
                    />
                  );
                }}
              </form.Field>
              {provider?.settings.map((fieldSpec) => (
                <form.Field
                  key={`setting-${draft.provider}-${fieldSpec.name}`}
                  name={`settings.${fieldSpec.name}` as never}
                >
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    const errors = invalid
                      ? toFieldErrors(field.state.meta.errors)
                      : undefined;
                    const input: IntegrationSettingRenderInput = {
                      id: `${idBase}-setting-${fieldSpec.name}`,
                      field: fieldSpec,
                      value:
                        (field.state.value as string | undefined) ??
                        draft.settings[fieldSpec.name] ??
                        '',
                      disabled,
                      errors,
                      onBlur: field.handleBlur,
                      onValueChange: (value) => {
                        field.handleChange(value as never);
                        onDraftChange({
                          ...draft,
                          settings: {
                            ...draft.settings,
                            [fieldSpec.name]: value,
                          },
                        });
                      },
                      draft,
                      data,
                    };
                    const custom = renderSetting?.(input);
                    if (custom !== undefined) {
                      return (
                        <Fragment key={`setting-${fieldSpec.name}`}>
                          {custom}
                        </Fragment>
                      );
                    }
                    return (
                      <IntegrationTextField
                        id={input.id}
                        field={fieldSpec}
                        value={input.value}
                        disabled={input.disabled}
                        errors={errors}
                        onBlur={field.handleBlur}
                        onValueChange={input.onValueChange}
                      />
                    );
                  }}
                </form.Field>
              ))}
              {provider?.secrets.map((fieldSpec) => (
                <form.Field
                  key={`secret-${draft.provider}-${fieldSpec.name}`}
                  name={`secrets.${fieldSpec.name}` as never}
                >
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    const errors = invalid
                      ? toFieldErrors(field.state.meta.errors)
                      : undefined;
                    return (
                      <IntegrationSecretField
                        id={`${idBase}-secret-${fieldSpec.name}`}
                        field={fieldSpec}
                        status={
                          sameProvider
                            ? saved?.secrets[fieldSpec.name]
                            : undefined
                        }
                        value={
                          (field.state.value as string | undefined) ??
                          draft.secrets[fieldSpec.name] ??
                          ''
                        }
                        disabled={disabled}
                        errors={errors}
                        onBlur={field.handleBlur}
                        onValueChange={(value) => {
                          field.handleChange(value as never);
                          onDraftChange({
                            ...draft,
                            secrets: {
                              ...draft.secrets,
                              [fieldSpec.name]: value,
                            },
                          });
                        }}
                      />
                    );
                  }}
                </form.Field>
              ))}
              {renderExtra?.({ draft, data })}
              {error ? <FieldError>{error}</FieldError> : null}
            </IntegrationCard>
          );
        }}
      </form.Subscribe>
    </form>
  );
}

function errorMessage(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // non-JSON body
  }
  return fallback;
}

/**
 * Self-loading Settings section for one single-instance integration served by
 * the current builtin's `/integrations/*` routes.
 */
export function IntegrationSection({
  integration,
  basePath = '/integrations',
  entryId,
  onSaved,
  renderSetting,
  renderExtra,
}: IntegrationFormExtensions & {
  integration: string;
  basePath?: string;
  entryId?: string;
  /** Called after a successful save or removal. */
  onSaved?: () => void;
}) {
  const api = useHostApi();
  const notifications = useHostNotifications();
  const [data, setData] = useState<IntegrationSectionData | null>(null);
  const [draft, setDraft] = useState<IntegrationDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = useMemo(
    () => `${basePath}/${encodeURIComponent(integration)}`,
    [basePath, integration],
  );

  const load = useCallback(async () => {
    const res = await api.fetch(path);
    if (!res.ok) {
      setError(errorMessage(res.body, 'Could not load integration.'));
      setLoading(false);
      return;
    }
    try {
      const next = JSON.parse(res.body) as IntegrationSectionData;
      setData(next);
      setDraft(draftFrom(next));
      setError(null);
    } catch {
      setError('Invalid integration response.');
    }
    setLoading(false);
  }, [api, path]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState size="sm">Loading…</LoadingState>;
  if (!data || !draft) return <FieldError>{error}</FieldError>;

  return (
    <IntegrationSettingsForm
      data={data}
      draft={draft}
      onDraftChange={(next) => {
        setDraft(next);
        if (error) setError(null);
      }}
      busy={busy}
      error={error}
      entryId={entryId}
      renderSetting={renderSetting}
      renderExtra={renderExtra}
      onSave={async (submittedDraft) => {
        const activeDraft = submittedDraft ?? draft;
        setBusy(true);
        const res = await api.fetch(path, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(integrationDraftBody(activeDraft)),
        });
        setBusy(false);
        if (!res.ok) {
          setError(errorMessage(res.body, 'Could not save integration.'));
          return;
        }
        await notifications.show(`${data.definition.label} saved`, 'info');
        await load();
        onSaved?.();
      }}
      onRemove={async () => {
        setBusy(true);
        const res = await api.fetch(path, { method: 'DELETE' });
        setBusy(false);
        if (!res.ok) {
          setError(errorMessage(res.body, 'Could not remove integration.'));
          return;
        }
        await notifications.show(`${data.definition.label} removed`, 'info');
        await load();
        onSaved?.();
      }}
      onTest={async () => {
        const dirty =
          draft.provider !== data.instances[0]?.provider ||
          Object.values(draft.secrets).some(Boolean) ||
          JSON.stringify(draft.settings) !==
            JSON.stringify(draftFrom(data).settings);
        const res = await api.fetch(`${path}/test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(dirty ? integrationDraftBody(draft) : {}),
        });
        if (!res.ok) {
          return { ok: false, message: errorMessage(res.body, 'Test failed') };
        }
        return JSON.parse(res.body) as IntegrationTestOutcome;
      }}
    />
  );
}
