import { generateText } from 'ai';
import type {
  IntegrationDefinition,
  IntegrationFieldDefinition,
  IntegrationsKit,
  ResolvedIntegration,
} from '@agentos/core/api/integrations';

import { aiErrorResponse } from './ai-errors';
import type { AiModels } from './create-model';
import {
  AI_PROVIDER_CAPABILITIES,
  AI_PROVIDER_IDS,
  AiConfigError,
  isAiProviderId,
  validateAiProviderConfig,
  type AiProviderConfig,
  type AiProviderId,
} from './providers';

export const AI_INTEGRATION_ID = 'ai';

export type AiModelSource = 'org' | 'platform';

export type ResolvedAiModels = {
  models: AiModels;
  source: AiModelSource;
  orgId: string | null;
};

const PROVIDER_LABELS: Record<
  AiProviderId,
  { label: string; description: string }
> = {
  openai: { label: 'OpenAI', description: 'GPT, embeddings, and images' },
  anthropic: { label: 'Anthropic', description: 'Claude (text only)' },
  google: { label: 'Google', description: 'Gemini and Imagen' },
  'ai-gateway': {
    label: 'Vercel AI Gateway',
    description: 'Any gateway model id, e.g. openai/gpt-5-mini',
  },
};

function readSetting(settings: Record<string, unknown>, name: string) {
  const value = settings[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Org integration record → provider config for the 108 factory. Secrets are
 * optional so drafts can be validated before a key is supplied.
 */
export function aiConfigFromIntegration(
  integration: Pick<ResolvedIntegration, 'provider' | 'settings' | 'secrets'>,
): AiProviderConfig {
  const { provider, settings, secrets } = integration;
  if (!isAiProviderId(provider)) {
    throw new AiConfigError(`Unknown AI provider "${provider}"`);
  }
  const embeddingModel = readSetting(settings, 'embeddingModel');
  const imageModel = readSetting(settings, 'imageModel');
  const baseUrl = readSetting(settings, 'baseUrl');
  if (baseUrl && !URL.canParse(baseUrl)) {
    throw new AiConfigError('Base URL must be an absolute URL');
  }
  const config: AiProviderConfig = {
    provider,
    apiKey: secrets.apiKey ?? '',
    model: readSetting(settings, 'model') ?? '',
    ...(embeddingModel ? { embeddingModel } : {}),
    ...(imageModel ? { imageModel } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
  validateAiProviderConfig(config);
  return config;
}

/**
 * Identity of the embedding space a config writes into. Vectors from two
 * identities are not comparable, so a change must be guarded.
 */
export function embeddingIdentity(
  provider: string,
  embeddingModel: string | null | undefined,
): string | null {
  return embeddingModel ? `${provider}:${embeddingModel}` : null;
}

function providerFields(id: AiProviderId): {
  settings: IntegrationFieldDefinition[];
  secrets: IntegrationFieldDefinition[];
} {
  const caps = AI_PROVIDER_CAPABILITIES[id];
  const settings: IntegrationFieldDefinition[] = [
    {
      name: 'model',
      label: 'Chat model',
      required: true,
      placeholder: id === 'ai-gateway' ? 'openai/gpt-5-mini' : undefined,
    },
  ];
  if (caps.embedding) {
    settings.push({
      name: 'embeddingModel',
      label: 'Embedding model',
      description:
        'Changing this is blocked while the org has stored vectors (they would no longer match).',
    });
  }
  if (caps.image) {
    settings.push({ name: 'imageModel', label: 'Image model' });
  }
  settings.push({
    name: 'baseUrl',
    label: 'Base URL',
    placeholder: 'Provider default',
    description: 'Optional regional or proxy endpoint.',
  });
  return {
    settings,
    secrets: [{ name: 'apiKey', label: 'API key', required: true }],
  };
}

export type AiIntegrationDefinitionOptions = {
  platform: AiModels;
  buildModels: (config: AiProviderConfig) => AiModels;
};

/** `ai` integration served by the builtin's `/integrations/*` routes. */
export function createAiIntegrationDefinition(
  options: AiIntegrationDefinitionOptions,
): IntegrationDefinition {
  const { platform, buildModels } = options;
  return {
    id: AI_INTEGRATION_ID,
    label: 'AI Models',
    description: 'Use your own AI provider account and models.',
    providers: AI_PROVIDER_IDS.map((id) => ({
      id,
      ...PROVIDER_LABELS[id],
      ...providerFields(id),
    })),
    platformDefault: () => ({
      provider: platform.provider,
      configured: platform.mode === 'configured',
    }),
    async test({ config }) {
      try {
        const models = config
          ? buildModels(aiConfigFromIntegration(config))
          : platform;
        const result = await generateText({
          model: models.language,
          prompt: 'Reply with the single word OK.',
          maxOutputTokens: 16,
        });
        const reply = result.text.trim().slice(0, 80);
        return {
          ok: true,
          message: `${models.provider} / ${models.model} replied: ${reply || '(empty)'}`,
        };
      } catch (error) {
        const { body } = aiErrorResponse(error, config?.provider ?? 'platform');
        return { ok: false, message: body.error };
      }
    },
  };
}

export type AiModelResolverOptions = {
  kit: Pick<IntegrationsKit, 'resolveProvider'>;
  platform: AiModels;
  buildModels: (config: AiProviderConfig) => AiModels;
  /** Active org for the request, or `null` (anonymous → platform). */
  resolveOrgId: (request: Request) => Promise<string | null>;
};

/** Per-request models: org integration when set, platform env otherwise. */
export function createAiModelResolver(
  options: AiModelResolverOptions,
): (request: Request) => Promise<ResolvedAiModels> {
  const { kit, platform, buildModels, resolveOrgId } = options;
  return async (request) => {
    const orgId = await resolveOrgId(request);
    const resolved = await kit.resolveProvider(
      orgId,
      AI_INTEGRATION_ID,
      (config) => buildModels(aiConfigFromIntegration(config)),
      () => platform,
    );
    return {
      models: resolved.provider,
      source: resolved.source === 'tenant' ? 'org' : 'platform',
      orgId,
    };
  };
}
