import { SettingsPage } from '@agentos/core/client/components/settings-page';
import { useCallback, useEffect, useState } from 'react';
import { useHostApi, useSettingsTarget } from '@agentos/core/client';
import { IntegrationSection } from '@agentos/core/client/components/integration-section';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@agentos/ui/components/alert';
import { FieldGroup } from '@agentos/ui/components/field';

import {
  AiModelCatalogLoader,
  AiModelField,
  type AiModelCatalog,
  type AiModelKind,
} from './ai-model-field';

type EmbeddingStatus = {
  current: string | null;
  platform: string | null;
  vectors: number | null;
  locked: boolean;
};

const MODEL_FIELDS: Record<string, AiModelKind> = {
  model: 'language',
  embeddingModel: 'embedding',
  imageModel: 'image',
};

/**
 * Settings › AI — the org's own AI provider (BYOK) with the platform default
 * as fallback. Mounted by the Shell Settings host.
 */
export default function AiSettings() {
  useSettingsTarget();
  const api = useHostApi();
  const [catalogs, setCatalogs] = useState<Record<string, AiModelCatalog>>({});
  const [embedding, setEmbedding] = useState<EmbeddingStatus | null>(null);

  const loadEmbeddingStatus = useCallback(async () => {
    const res = await api.fetch('/integrations/ai/embedding-status');
    if (!res.ok) return;
    try {
      setEmbedding(JSON.parse(res.body) as EmbeddingStatus);
    } catch {
      // status is advisory; the save route enforces the guard
    }
  }, [api]);

  useEffect(() => {
    void loadEmbeddingStatus();
  }, [loadEmbeddingStatus]);

  return (
    <SettingsPage data-slot="ai-settings">
      <FieldGroup className="gap-8">
        {embedding?.locked ? (
          <Alert>
            <AlertTitle>Embedding model locked</AlertTitle>
            <AlertDescription>
              This org has {embedding.vectors} stored vector
              {embedding.vectors === 1 ? '' : 's'} embedded with{' '}
              <code>{embedding.current}</code>. Changing the embedding model (or
              removing your key when the platform uses a different one) is
              blocked until they are deleted or re-embedded.
            </AlertDescription>
          </Alert>
        ) : null}
        <IntegrationSection
          integration="ai"
          entryId="ai-provider"
          onSaved={() => void loadEmbeddingStatus()}
          renderSetting={(input) => {
            const kind = MODEL_FIELDS[input.field.name];
            if (!kind) return undefined;
            return (
              <AiModelField
                {...input}
                options={catalogs[input.draft.provider]?.[kind]}
              />
            );
          }}
          renderExtra={({ draft, data }) => {
            if (!data.canManage) return null;
            const saved = data.instances[0];
            return (
              <AiModelCatalogLoader
                provider={draft.provider}
                apiKey={draft.secrets.apiKey}
                baseUrl={draft.settings.baseUrl}
                auto={
                  draft.provider === 'ai-gateway' ||
                  (saved?.provider === draft.provider &&
                    Boolean(saved.secrets.apiKey))
                }
                onLoaded={(provider, catalog) =>
                  setCatalogs((prev) => ({ ...prev, [provider]: catalog }))
                }
              />
            );
          }}
        />
      </FieldGroup>
    </SettingsPage>
  );
}
