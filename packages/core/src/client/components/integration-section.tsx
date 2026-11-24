import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@agentos/ui/components/button';
import { FieldError } from '@agentos/ui/components/field';
import { LoadingState } from '@agentos/ui/components/loading-state';

import { useHostApi } from '../lib/use-host-api';
import { useHostNotifications } from '../lib/use-host-notifications';
import {
  IntegrationCard,
  IntegrationProviderPicker,
  IntegrationRemoveButton,
  IntegrationSecretField,
  IntegrationTestButton,
  IntegrationTextField,
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

export type IntegrationSettingsFormProps = {
  data: IntegrationSectionData;
  draft: IntegrationDraft;
  onDraftChange: (draft: IntegrationDraft) => void;
  busy?: boolean;
  error?: string | null;
  onSave: () => void;
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
}: IntegrationSettingsFormProps) {
  const saved = data.instances[0];
  const provider = data.definition.providers.find(
    (p) => p.id === draft.provider,
  );
  const readOnly = !data.canManage;
  const sameProvider = saved?.provider === draft.provider;
  const idBase = `integration-${data.definition.id.replace(/\./g, '-')}`;

  return (
    <IntegrationCard
      title={data.definition.label}
      description={data.definition.description}
      source={saved ? 'tenant' : 'platform'}
      platformConfigured={data.platformDefault?.configured ?? true}
      entryId={entryId}
      footer={
        readOnly ? (
          <span className="text-xs text-muted-foreground">
            Only admins can change this integration.
          </span>
        ) : (
          <>
            <Button type="button" size="sm" disabled={busy} onClick={onSave}>
              Save
            </Button>
            {data.definition.testable ? (
              <IntegrationTestButton onTest={onTest} disabled={busy} />
            ) : null}
            {saved ? (
              <span className="ml-auto">
                <IntegrationRemoveButton
                  name={data.definition.label}
                  onConfirm={onRemove}
                  disabled={busy}
                />
              </span>
            ) : null}
          </>
        )
      }
    >
      {!saved && data.platformDefault ? (
        <p className="text-xs text-muted-foreground">
          {data.platformDefault.configured
            ? `Using the platform default (${data.platformDefault.provider}) until you add your own key.`
            : 'No platform default is configured. Add your own provider to enable this integration.'}
        </p>
      ) : null}
      <IntegrationProviderPicker
        id={`${idBase}-provider`}
        providers={data.definition.providers}
        value={draft.provider}
        disabled={readOnly || busy}
        onValueChange={(next) =>
          onDraftChange({ ...draft, provider: next, secrets: {} })
        }
      />
      {provider?.settings.map((field) => (
        <IntegrationTextField
          key={`setting-${field.name}`}
          id={`${idBase}-setting-${field.name}`}
          field={field}
          value={draft.settings[field.name] ?? ''}
          disabled={readOnly || busy}
          onValueChange={(value) =>
            onDraftChange({
              ...draft,
              settings: { ...draft.settings, [field.name]: value },
            })
          }
        />
      ))}
      {provider?.secrets.map((field) => (
        <IntegrationSecretField
          key={`secret-${draft.provider}-${field.name}`}
          id={`${idBase}-secret-${field.name}`}
          field={field}
          status={sameProvider ? saved?.secrets[field.name] : undefined}
          value={draft.secrets[field.name] ?? ''}
          disabled={readOnly || busy}
          onValueChange={(value) =>
            onDraftChange({
              ...draft,
              secrets: { ...draft.secrets, [field.name]: value },
            })
          }
        />
      ))}
      {error ? <FieldError>{error}</FieldError> : null}
    </IntegrationCard>
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
}: {
  integration: string;
  basePath?: string;
  entryId?: string;
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
      onDraftChange={setDraft}
      busy={busy}
      error={error}
      entryId={entryId}
      onSave={async () => {
        setBusy(true);
        const res = await api.fetch(path, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(integrationDraftBody(draft)),
        });
        setBusy(false);
        if (!res.ok) {
          setError(errorMessage(res.body, 'Could not save integration.'));
          return;
        }
        await notifications.show(`${data.definition.label} saved`, 'info');
        await load();
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
