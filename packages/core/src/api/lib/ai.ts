/**
 * @agentos/core/api/ai — HTTP client for builtin `ai` (ticket 23 / 85).
 */

import { getJson, postJson, resolveExtApiBase, type EnvMap } from './http';

/** Resolve builtin ai API base (`…/api/ext/ai` or test override). */
export function resolveAiApiBase(env: EnvMap = Bun.env): string {
  return resolveExtApiBase('ai', 'AGENT_OS_AI_API_BASE', env);
}

/** File/image input: files-builtin key or inline base64. */
export type AiFileInput = {
  mediaType: string;
  key?: string;
  base64?: string;
};

export type GenerateTextInput = {
  prompt?: string;
  message?: string;
  text?: string;
  temperature?: number;
  maxTokens?: number;
  /** JSON Schema for schema-constrained object output. */
  schema?: Record<string, unknown>;
  /** Multimodal attachments (PDF / images). */
  files?: AiFileInput[];
};

export type GenerateTextResult = {
  text?: string;
  object?: unknown;
};

export type GenerateImageResult = {
  stub: boolean;
  mediaType: string;
  base64: string | null;
};

export type EmbedInput = { value?: string; text?: string };

export type EmbedResult = { embedding: number[]; stub: boolean };

export type ChatInput = {
  prompt?: string;
  message?: string;
  text?: string;
  registry?: unknown;
};

export type ChatResult = { text: string; toolNames?: string[] };

export type AiHealth = { ok: true; mode: string };

export async function health(env?: EnvMap): Promise<AiHealth> {
  const base = resolveAiApiBase(env ?? Bun.env);
  return getJson<AiHealth>(`${base}/health`, 'ai health');
}

export async function generateText(
  input: GenerateTextInput,
  env?: EnvMap,
): Promise<GenerateTextResult> {
  const base = resolveAiApiBase(env ?? Bun.env);
  return postJson<GenerateTextResult>(
    `${base}/generate-text`,
    input,
    'ai generate-text',
  );
}

export async function generateImage(
  input: GenerateTextInput,
  env?: EnvMap,
): Promise<GenerateImageResult> {
  const base = resolveAiApiBase(env ?? Bun.env);
  return postJson<GenerateImageResult>(
    `${base}/generate-image`,
    input,
    'ai generate-image',
  );
}

export async function embed(
  input: EmbedInput,
  env?: EnvMap,
): Promise<EmbedResult> {
  const base = resolveAiApiBase(env ?? Bun.env);
  return postJson<EmbedResult>(`${base}/embed`, input, 'ai embed');
}

export async function chat(
  input: ChatInput,
  env?: EnvMap,
): Promise<ChatResult> {
  const base = resolveAiApiBase(env ?? Bun.env);
  return postJson<ChatResult>(`${base}/chat`, input, 'ai chat');
}
