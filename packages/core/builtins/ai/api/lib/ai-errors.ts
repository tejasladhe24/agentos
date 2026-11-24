import { APICallError, LoadAPIKeyError, RetryError } from 'ai';

import type { AiModels } from './create-model';
import { AiConfigError, type AiCapability } from './providers';

export class AiCapabilityError extends Error {
  override name = 'AiCapabilityError';
  constructor(
    readonly provider: string,
    readonly capability: AiCapability,
  ) {
    const label = capability === 'embedding' ? 'embeddings' : 'images';
    const envName =
      capability === 'embedding'
        ? 'AGENT_OS_EXT_AI_EMBEDDING_MODEL'
        : 'AGENT_OS_EXT_AI_IMAGE_MODEL';
    super(
      `AI provider "${provider}" is not configured for ${label} (set ${envName} on a provider that supports it)`,
    );
  }
}

export function requireEmbeddingModel(models: AiModels) {
  if (!models.embedding) {
    throw new AiCapabilityError(models.provider, 'embedding');
  }
  return models.embedding;
}

export function requireImageModel(models: AiModels) {
  if (!models.image) throw new AiCapabilityError(models.provider, 'image');
  return models.image;
}

export type AiErrorBody = {
  error: string;
  code:
    | 'ai_capability_unsupported'
    | 'ai_config_invalid'
    | 'ai_provider_auth'
    | 'ai_provider_rate_limited'
    | 'ai_provider_error'
    | 'ai_internal';
  provider?: string;
  status?: number;
};

function unwrapRetry(error: unknown): unknown {
  if (RetryError.isInstance(error) && error.lastError) return error.lastError;
  return error;
}

/** Map AI SDK / config errors to an HTTP status + stable JSON body (no secrets). */
export function aiErrorResponse(
  error: unknown,
  provider: string,
): { status: number; body: AiErrorBody } {
  const err = unwrapRetry(error);
  if (err instanceof AiCapabilityError) {
    return {
      status: 501,
      body: { error: err.message, code: 'ai_capability_unsupported', provider },
    };
  }
  if (err instanceof AiConfigError || LoadAPIKeyError.isInstance(err)) {
    return {
      status: 500,
      body: { error: err.message, code: 'ai_config_invalid', provider },
    };
  }
  if (APICallError.isInstance(err)) {
    const upstream = err.statusCode;
    if (upstream === 401 || upstream === 403) {
      return {
        status: 502,
        body: {
          error: `AI provider "${provider}" rejected the API key (${upstream})`,
          code: 'ai_provider_auth',
          provider,
          status: upstream,
        },
      };
    }
    if (upstream === 429) {
      return {
        status: 503,
        body: {
          error: `AI provider "${provider}" rate limited the request`,
          code: 'ai_provider_rate_limited',
          provider,
          status: upstream,
        },
      };
    }
    return {
      status: 502,
      body: {
        error: `AI provider "${provider}" error: ${err.message}`,
        code: 'ai_provider_error',
        provider,
        ...(upstream ? { status: upstream } : {}),
      },
    };
  }
  return {
    status: 500,
    body: {
      error: err instanceof Error ? err.message : String(err),
      code: 'ai_internal',
    },
  };
}
