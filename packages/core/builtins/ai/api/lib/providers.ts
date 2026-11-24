import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import {
  createGateway,
  defaultEmbeddingSettingsMiddleware,
  defaultSettingsMiddleware,
  wrapEmbeddingModel,
  wrapLanguageModel,
  type EmbeddingModel,
  type ImageModel,
  type LanguageModel,
} from 'ai';

import type { FetchLike } from './fetch-like';

export const AI_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'ai-gateway',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiCapability = 'language' | 'embedding' | 'image';

/** Plain, serializable provider config (env today; per-org integration in ticket 109). */
export type AiProviderConfig = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  embeddingModel?: string;
  imageModel?: string;
  baseUrl?: string;
  /** `ai-gateway` only: route to providers with zero-data-retention agreements. */
  zeroDataRetention?: boolean;
};

export type AiProviderOptions = {
  /** Injected HTTP client (tests); never part of the cache key. */
  fetch?: FetchLike;
};

export const AI_PROVIDER_CAPABILITIES: Record<
  AiProviderId,
  Record<AiCapability, boolean>
> = {
  openai: { language: true, embedding: true, image: true },
  anthropic: { language: true, embedding: false, image: false },
  google: { language: true, embedding: true, image: true },
  'ai-gateway': { language: true, embedding: true, image: true },
};

export class AiConfigError extends Error {
  override name = 'AiConfigError';
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return (
    typeof value === 'string' &&
    (AI_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/** Throws {@link AiConfigError} when the config cannot build models. */
export function validateAiProviderConfig(config: AiProviderConfig): void {
  if (!isAiProviderId(config.provider)) {
    throw new AiConfigError(
      `Unknown AI provider "${String(config.provider)}" (expected one of ${AI_PROVIDER_IDS.join(', ')})`,
    );
  }
  if (!config.apiKey?.trim()) {
    throw new AiConfigError(
      `AI provider "${config.provider}" needs an API key`,
    );
  }
  if (!config.model?.trim()) {
    throw new AiConfigError(
      `AI provider "${config.provider}" needs a model id`,
    );
  }
  const caps = AI_PROVIDER_CAPABILITIES[config.provider];
  if (config.embeddingModel && !caps.embedding) {
    throw new AiConfigError(
      `AI provider "${config.provider}" does not offer embedding models`,
    );
  }
  if (config.imageModel && !caps.image) {
    throw new AiConfigError(
      `AI provider "${config.provider}" does not offer image models`,
    );
  }
}

export type BuiltProviderModels = {
  language: LanguageModel;
  embedding: EmbeddingModel | null;
  image: ImageModel | null;
};

type OpenAIProvider = ReturnType<typeof createOpenAI>;

type ProviderFactory = {
  languageModel(modelId: string): ReturnType<OpenAIProvider['languageModel']>;
  embeddingModel?(
    modelId: string,
  ): ReturnType<OpenAIProvider['embeddingModel']>;
  imageModel?(modelId: string): ImageModel;
};

type ProviderOptionsBag = Record<string, Record<string, boolean>>;

/**
 * Data policy: request no storage / no prompt training where the provider
 * exposes a per-request switch. Anthropic and paid Gemini API tiers do not
 * train on API traffic by default and expose no per-request flag.
 */
function dataPolicyProviderOptions(
  config: AiProviderConfig,
): ProviderOptionsBag | null {
  switch (config.provider) {
    case 'openai':
      return { openai: { store: false } };
    case 'ai-gateway':
      return {
        gateway: {
          disallowPromptTraining: true,
          ...(config.zeroDataRetention ? { zeroDataRetention: true } : {}),
        },
      };
    default:
      return null;
  }
}

function createProviderFactory(
  config: AiProviderConfig,
  options: AiProviderOptions,
): ProviderFactory {
  const settings = {
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(options.fetch ? { fetch: options.fetch as typeof fetch } : {}),
  };
  switch (config.provider) {
    case 'openai': {
      const p = createOpenAI(settings);
      return {
        languageModel: (id) => p.languageModel(id),
        embeddingModel: (id) => p.embeddingModel(id),
        imageModel: (id) => p.imageModel(id),
      };
    }
    case 'anthropic': {
      const p = createAnthropic(settings);
      return { languageModel: (id) => p.languageModel(id) };
    }
    case 'google': {
      const p = createGoogleGenerativeAI(settings);
      return {
        languageModel: (id) => p.languageModel(id),
        embeddingModel: (id) => p.embeddingModel(id),
        imageModel: (id) => p.image(id),
      };
    }
    case 'ai-gateway': {
      const p = createGateway(settings);
      return {
        languageModel: (id) => p.languageModel(id),
        embeddingModel: (id) => p.embeddingModel(id),
        imageModel: (id) => p.imageModel(id),
      };
    }
  }
}

/** Pure: same config → equivalent models. Validates first. */
export function buildProviderModels(
  config: AiProviderConfig,
  options: AiProviderOptions = {},
): BuiltProviderModels {
  validateAiProviderConfig(config);
  const factory = createProviderFactory(config, options);
  const providerOptions = dataPolicyProviderOptions(config);

  const baseLanguage = factory.languageModel(config.model);
  const language = providerOptions
    ? wrapLanguageModel({
        model: baseLanguage,
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions },
        }),
      })
    : baseLanguage;

  let embedding: EmbeddingModel | null = null;
  if (config.embeddingModel && factory.embeddingModel) {
    const baseEmbedding = factory.embeddingModel(config.embeddingModel);
    embedding =
      providerOptions && config.provider === 'ai-gateway'
        ? wrapEmbeddingModel({
            model: baseEmbedding,
            middleware: defaultEmbeddingSettingsMiddleware({
              settings: { providerOptions },
            }),
          })
        : baseEmbedding;
  }

  const image =
    config.imageModel && factory.imageModel
      ? factory.imageModel(config.imageModel)
      : null;

  return { language, embedding, image };
}

/** Stable cache key; the API key is hashed so plaintext never sits in map keys. */
export function aiConfigHash(config: AiProviderConfig): string {
  const canonical = JSON.stringify([
    config.provider,
    config.apiKey,
    config.model,
    config.embeddingModel ?? null,
    config.imageModel ?? null,
    config.baseUrl ?? null,
    config.zeroDataRetention === true,
  ]);
  return new Bun.CryptoHasher('sha256').update(canonical).digest('hex');
}
