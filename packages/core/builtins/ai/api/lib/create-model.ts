import type { EmbeddingModel, ImageModel, LanguageModel } from 'ai';
import {
  MockEmbeddingModelV4,
  MockImageModelV4,
  MockLanguageModelV4,
} from 'ai/test';

import {
  aiConfigHash,
  buildProviderModels,
  type AiProviderConfig,
  type AiProviderId,
  type AiProviderOptions,
} from './providers';
import { stubFromJsonSchema } from './stub-from-schema';
import { MOCK_USAGE } from './usage';

type PromptMessage = {
  role?: string;
  content?: unknown;
};

type ContentPart = {
  type?: string;
  text?: string;
};

function countFileParts(prompt: unknown): number {
  if (!Array.isArray(prompt)) return 0;
  let count = 0;
  for (const msg of prompt as PromptMessage[]) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as ContentPart[]) {
      if (part?.type === 'file' || part?.type === 'image') count += 1;
    }
  }
  return count;
}

function extractLastUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return '';
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i] as PromptMessage;
    if (msg?.role !== 'user') continue;
    const content = msg.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const texts = content
        .filter(
          (part): part is { type: string; text?: string } =>
            !!part &&
            typeof part === 'object' &&
            (part as { type?: string }).type === 'text',
        )
        .map((part) => part.text ?? '')
        .filter(Boolean);
      if (texts.length > 0) return texts.join('\n');
    }
  }
  return '';
}

function extractSystemDigest(prompt: unknown): string {
  if (!Array.isArray(prompt)) return '';
  const system = (prompt as PromptMessage[]).find((m) => m.role === 'system');
  if (!system) return '';
  const content =
    typeof system.content === 'string'
      ? system.content
      : String(system.content ?? '');
  const trimmed = content.trim();
  if (!trimmed) return '';
  return trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
}

function hasToolResults(prompt: unknown): boolean {
  if (!Array.isArray(prompt)) return false;
  return (prompt as PromptMessage[]).some((m) => m.role === 'tool');
}

function summarizeToolResults(prompt: unknown): string {
  if (!Array.isArray(prompt)) return '';
  const parts: string[] = [];
  for (const msg of prompt as PromptMessage[]) {
    if (msg.role !== 'tool') continue;
    parts.push(
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content),
    );
  }
  return parts.join('\n');
}

/**
 * Default language model: deterministic mock that echoes the user prompt and
 * optionally emits a single tool call for `/tool <extId>.<name> <json>`.
 * Structured JSON (`responseFormat.type === 'json'`) returns a schema stub.
 */
export function createMockLanguageModel(): LanguageModel {
  return new MockLanguageModelV4({
    provider: 'agentos-mock',
    modelId: 'mock-text',
    doGenerate: async (options) => {
      if (hasToolResults(options.prompt)) {
        const summary = summarizeToolResults(options.prompt);
        return {
          content: [
            {
              type: 'text',
              text: `Mock tool result: ${summary}`,
            },
          ],
          finishReason: { unified: 'stop', raw: undefined },
          usage: MOCK_USAGE,
          warnings: [],
        };
      }

      const userText = extractLastUserText(options.prompt);
      const fileCount = countFileParts(options.prompt);
      const responseFormat = options.responseFormat;

      if (responseFormat?.type === 'json') {
        const stub = stubFromJsonSchema(responseFormat.schema, {
          prompt: userText,
          hasFiles: fileCount > 0,
          fileCount,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stub),
            },
          ],
          finishReason: { unified: 'stop', raw: undefined },
          usage: MOCK_USAGE,
          warnings: [],
        };
      }

      const toolMatch = /^\/tool\s+([\w-]+)\.([\w-]+)\s*(.*)$/s.exec(
        userText.trim(),
      );
      // AI SDK v7 passes tools to the model as a function-definition array.
      const toolDefs = Array.isArray(options.tools) ? options.tools : [];
      const available = new Set(
        toolDefs
          .map((t) =>
            t &&
            typeof t === 'object' &&
            typeof (t as { name?: string }).name === 'string'
              ? (t as { name: string }).name
              : null,
          )
          .filter((n): n is string => Boolean(n)),
      );
      if (toolMatch) {
        const toolName = `${toolMatch[1]}__${toolMatch[2]}`;
        if (available.has(toolName)) {
          const rawInput = toolMatch[3]?.trim() || '{}';
          let input = rawInput;
          try {
            input = JSON.stringify(JSON.parse(rawInput));
          } catch {
            input = JSON.stringify({ raw: rawInput });
          }
          return {
            content: [
              {
                type: 'tool-call',
                toolCallId: 'mock-tool-1',
                toolName,
                input,
              },
            ],
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: MOCK_USAGE,
            warnings: [],
          };
        }
      }

      const digest = extractSystemDigest(options.prompt);
      const prefix = digest
        ? `Mock (instructions: ${digest.replace(/\s+/g, ' ')})`
        : 'Mock';
      const filesNote = fileCount > 0 ? ` [files:${fileCount}]` : '';
      return {
        content: [
          {
            type: 'text',
            text: `${prefix}: ${userText}${filesNote}`,
          },
        ],
        finishReason: { unified: 'stop', raw: undefined },
        usage: MOCK_USAGE,
        warnings: [],
      };
    },
  });
}

export function createMockEmbeddingModel(): EmbeddingModel {
  return new MockEmbeddingModelV4({
    provider: 'agentos-mock',
    modelId: 'mock-embed',
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => [0.01, 0.02, 0.03, 0.04]),
      usage: { tokens: values.length },
      warnings: [],
    }),
  });
}

export function createMockImageModel(): ImageModel {
  return new MockImageModelV4({
    provider: 'agentos-mock',
    modelId: 'mock-image',
    doGenerate: async () => ({
      // Tiny 1x1 PNG
      images: [
        Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
          0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63,
          0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05,
          0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
          0xae, 0x42, 0x60, 0x82,
        ]),
      ],
      warnings: [],
      response: {
        timestamp: new Date(),
        modelId: 'mock-image',
        headers: undefined,
      },
    }),
  });
}

export type AiModels = {
  mode: 'mock' | 'configured';
  provider: AiProviderId | 'mock';
  model: string;
  language: LanguageModel;
  /** `null` → capability not available for this provider/config. */
  embedding: EmbeddingModel | null;
  image: ImageModel | null;
  embeddingModel: string | null;
  imageModel: string | null;
};

export function createMockAiModels(): AiModels {
  return {
    mode: 'mock',
    provider: 'mock',
    model: 'mock-text',
    language: createMockLanguageModel(),
    embedding: createMockEmbeddingModel(),
    image: createMockImageModel(),
    embeddingModel: 'mock-embed',
    imageModel: 'mock-image',
  };
}

/**
 * Resolve models for the AI builtin. No config → mock suite (ADR 006 default).
 * Pure function of `config` so callers (ticket 109) can build per org.
 */
export function createAiModels(
  config?: AiProviderConfig | null,
  options: AiProviderOptions = {},
): AiModels {
  if (!config) return createMockAiModels();
  const built = buildProviderModels(config, options);
  return {
    mode: 'configured',
    provider: config.provider,
    model: config.model,
    ...built,
    embeddingModel: built.embedding ? (config.embeddingModel ?? null) : null,
    imageModel: built.image ? (config.imageModel ?? null) : null,
  };
}

const MODEL_CACHE_LIMIT = 64;
const modelCache = new Map<string, AiModels>();

/** {@link createAiModels} memoized by {@link aiConfigHash} (LRU, bounded). */
export function getCachedAiModels(config?: AiProviderConfig | null): AiModels {
  if (!config) return createAiModels(null);
  const key = aiConfigHash(config);
  const hit = modelCache.get(key);
  if (hit) {
    modelCache.delete(key);
    modelCache.set(key, hit);
    return hit;
  }
  const models = createAiModels(config);
  modelCache.set(key, models);
  if (modelCache.size > MODEL_CACHE_LIMIT) {
    const oldest = modelCache.keys().next().value;
    if (oldest !== undefined) modelCache.delete(oldest);
  }
  return models;
}

export function clearAiModelCache(): void {
  modelCache.clear();
}
