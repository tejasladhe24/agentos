import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

import { AI_PORT, DEFAULT_GATEWAY_URL } from './lib/constants';
import {
  AI_PROVIDER_IDS,
  AiConfigError,
  validateAiProviderConfig,
  type AiProviderConfig,
} from './lib/providers';

type RuntimeEnv = Record<string, string | undefined>;

/** AI extension env (`AGENT_OS_EXT_AI_*`). Pass into app `createEnv({ extends: [keys()] })`. */
export const keys = (runtimeEnv: RuntimeEnv = Bun.env) =>
  createEnv({
    server: {
      AGENT_OS_EXT_AI_PORT: z.coerce.number().int().positive().default(AI_PORT),
      AGENT_OS_EXT_AI_GATEWAY_URL: z
        .string()
        .url()
        .default(DEFAULT_GATEWAY_URL),
      /** Unset or `mock` → mock models via `ai/test` (ADR 006). */
      AGENT_OS_EXT_AI_PROVIDER: z.enum(['mock', ...AI_PROVIDER_IDS]).optional(),
      AGENT_OS_EXT_AI_API_KEY: z.string().min(1).optional(),
      AGENT_OS_EXT_AI_MODEL: z.string().min(1).optional(),
      AGENT_OS_EXT_AI_EMBEDDING_MODEL: z.string().min(1).optional(),
      AGENT_OS_EXT_AI_IMAGE_MODEL: z.string().min(1).optional(),
      /** Provider API base URL (regional / proxy endpoints). */
      AGENT_OS_EXT_AI_BASE_URL: z.string().url().optional(),
      AGENT_OS_EXT_AI_ZERO_DATA_RETENTION: z
        .enum(['true', 'false', '1', '0'])
        .optional()
        .transform((v) => v === 'true' || v === '1'),
    },
    clientPrefix: 'AGENT_OS_EXT_AI_CLIENT',
    client: {},
    runtimeEnv: {
      AGENT_OS_EXT_AI_PORT: runtimeEnv.AGENT_OS_EXT_AI_PORT,
      AGENT_OS_EXT_AI_GATEWAY_URL: runtimeEnv.AGENT_OS_EXT_AI_GATEWAY_URL,
      AGENT_OS_EXT_AI_PROVIDER: runtimeEnv.AGENT_OS_EXT_AI_PROVIDER,
      AGENT_OS_EXT_AI_API_KEY: runtimeEnv.AGENT_OS_EXT_AI_API_KEY,
      AGENT_OS_EXT_AI_MODEL: runtimeEnv.AGENT_OS_EXT_AI_MODEL,
      AGENT_OS_EXT_AI_EMBEDDING_MODEL:
        runtimeEnv.AGENT_OS_EXT_AI_EMBEDDING_MODEL,
      AGENT_OS_EXT_AI_IMAGE_MODEL: runtimeEnv.AGENT_OS_EXT_AI_IMAGE_MODEL,
      AGENT_OS_EXT_AI_BASE_URL: runtimeEnv.AGENT_OS_EXT_AI_BASE_URL,
      AGENT_OS_EXT_AI_ZERO_DATA_RETENTION:
        runtimeEnv.AGENT_OS_EXT_AI_ZERO_DATA_RETENTION,
    },
    emptyStringAsUndefined: true,
  });

export type AiEnv = ReturnType<typeof keys>;

/**
 * Platform AI config from env, or `null` for the mock suite.
 * Throws {@link AiConfigError} when a provider is set but incomplete.
 */
export function aiConfigFromEnv(
  env: Pick<
    AiEnv,
    | 'AGENT_OS_EXT_AI_PROVIDER'
    | 'AGENT_OS_EXT_AI_API_KEY'
    | 'AGENT_OS_EXT_AI_MODEL'
    | 'AGENT_OS_EXT_AI_EMBEDDING_MODEL'
    | 'AGENT_OS_EXT_AI_IMAGE_MODEL'
    | 'AGENT_OS_EXT_AI_BASE_URL'
    | 'AGENT_OS_EXT_AI_ZERO_DATA_RETENTION'
  >,
): AiProviderConfig | null {
  const provider = env.AGENT_OS_EXT_AI_PROVIDER;
  if (!provider || provider === 'mock') return null;
  if (!env.AGENT_OS_EXT_AI_API_KEY) {
    throw new AiConfigError(
      `AGENT_OS_EXT_AI_API_KEY is required when AGENT_OS_EXT_AI_PROVIDER=${provider}`,
    );
  }
  if (!env.AGENT_OS_EXT_AI_MODEL) {
    throw new AiConfigError(
      `AGENT_OS_EXT_AI_MODEL is required when AGENT_OS_EXT_AI_PROVIDER=${provider}`,
    );
  }
  const config: AiProviderConfig = {
    provider,
    apiKey: env.AGENT_OS_EXT_AI_API_KEY,
    model: env.AGENT_OS_EXT_AI_MODEL,
    ...(env.AGENT_OS_EXT_AI_EMBEDDING_MODEL
      ? { embeddingModel: env.AGENT_OS_EXT_AI_EMBEDDING_MODEL }
      : {}),
    ...(env.AGENT_OS_EXT_AI_IMAGE_MODEL
      ? { imageModel: env.AGENT_OS_EXT_AI_IMAGE_MODEL }
      : {}),
    ...(env.AGENT_OS_EXT_AI_BASE_URL
      ? { baseUrl: env.AGENT_OS_EXT_AI_BASE_URL }
      : {}),
    ...(env.AGENT_OS_EXT_AI_ZERO_DATA_RETENTION
      ? { zeroDataRetention: true }
      : {}),
  };
  validateAiProviderConfig(config);
  return config;
}
