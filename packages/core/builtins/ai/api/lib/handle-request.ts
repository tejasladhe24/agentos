import {
  embed,
  generateImage,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
} from 'ai';

import type { ResolvedAiModels } from './ai-integration';
import {
  aiErrorResponse,
  requireEmbeddingModel,
  requireImageModel,
} from './ai-errors';
import type { AiModels } from './create-model';
import type { FetchLike } from './fetch-like';
import {
  attachmentAuth,
  isResolveAttachmentsError,
  resolveAttachments,
  type ResolvedAttachment,
} from './resolve-attachments';
import { fetchAgentRegistry, runChat } from './run-chat';
import {
  usageTokens,
  type AiOperation,
  type AiUsageRecorder,
} from './usage-attribution';

export const AI_SOURCE_HEADER = 'x-agentos-ai-source';

export type AiHandlerContext = {
  /** Platform (env) models; also the fallback when no resolver is set. */
  models: AiModels;
  gatewayUrl: string;
  fetchImpl?: FetchLike;
  /** Per-request models (org BYOK integration, else platform). */
  resolveModels?: (request: Request) => Promise<ResolvedAiModels>;
  /** `/integrations/*` and related routes; `null` → not handled. */
  handleIntegrations?: (request: Request) => Promise<Response | null>;
  recordUsage?: AiUsageRecorder;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

const OPERATIONS: Record<string, AiOperation> = {
  '/generate-text': 'generate-text',
  '/generate-image': 'generate-image',
  '/embed': 'embed',
  '/chat': 'chat',
};

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function readPrompt(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.prompt === 'string' && body.prompt.length > 0) {
    return body.prompt;
  }
  if (typeof body.message === 'string' && body.message.length > 0) {
    return body.message;
  }
  if (typeof body.text === 'string' && body.text.length > 0) {
    return body.text;
  }
  return null;
}

function readSchema(
  body: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!body) return null;
  const schema = body.schema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return null;
  }
  return schema as Record<string, unknown>;
}

function buildUserContent(
  prompt: string,
  attachments: ResolvedAttachment[],
):
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'file'; data: Uint8Array; mediaType: string }
    > {
  if (attachments.length === 0) return prompt;
  return [
    { type: 'text', text: prompt },
    ...attachments.map((file) => ({
      type: 'file' as const,
      data: file.data,
      mediaType: file.mediaType,
    })),
  ];
}

/**
 * Thin Bun request router for `/api/ext/ai/*` upstream paths.
 */
export async function handleAiRequest(
  ctx: AiHandlerContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const fetchImpl = ctx.fetchImpl ?? fetch;

  if (method === 'GET' && path === '/health') {
    const { models } = ctx;
    if (models.mode === 'mock') return json({ ok: true, mode: models.mode });
    return json({
      ok: true,
      mode: models.mode,
      provider: models.provider,
      model: models.model,
      capabilities: {
        language: true,
        embedding: Boolean(models.embedding),
        image: Boolean(models.image),
      },
    });
  }

  if (ctx.handleIntegrations) {
    const handled = await ctx.handleIntegrations(request);
    if (handled) return handled;
  }

  const operation = OPERATIONS[path];
  if (method !== 'POST' || !operation) {
    return json({ error: 'not found' }, { status: 404 });
  }

  let resolved: ResolvedAiModels = {
    models: ctx.models,
    source: 'platform',
    orgId: null,
  };
  const respond = (data: unknown, usage?: unknown): Response => {
    const event = {
      orgId: resolved.orgId,
      source: resolved.source,
      provider: resolved.models.provider,
      model:
        operation === 'embed'
          ? (resolved.models.embeddingModel ?? resolved.models.model)
          : operation === 'generate-image'
            ? (resolved.models.imageModel ?? resolved.models.model)
            : resolved.models.model,
      operation,
      ...usageTokens(usage),
    };
    const record = ctx.recordUsage;
    if (record) {
      void Promise.resolve()
        .then(() => record(event))
        .catch(() => {});
    }
    return json(data, { headers: { [AI_SOURCE_HEADER]: resolved.source } });
  };

  try {
    if (ctx.resolveModels) resolved = await ctx.resolveModels(request);
    const { models } = resolved;
    switch (path) {
      case '/generate-text': {
        const body = await readJsonBody(request);
        const prompt = readPrompt(body);
        if (!prompt) {
          return json({ error: 'prompt required' }, { status: 400 });
        }

        const attachments = await resolveAttachments(
          body?.files,
          ctx.gatewayUrl,
          fetchImpl,
          attachmentAuth(request),
        );
        if (isResolveAttachmentsError(attachments)) {
          return json(
            { error: attachments.error },
            { status: attachments.status },
          );
        }

        const schema = readSchema(body);
        const temperature =
          typeof body?.temperature === 'number'
            ? { temperature: body.temperature }
            : {};
        const maxTokens =
          typeof body?.maxTokens === 'number'
            ? { maxOutputTokens: body.maxTokens }
            : {};
        const content = buildUserContent(prompt, attachments);

        if (schema) {
          try {
            const result = await generateText({
              model: models.language,
              messages: [{ role: 'user', content }],
              output: Output.object({
                schema: jsonSchema(schema),
              }),
              ...temperature,
              ...maxTokens,
            });
            return respond({ object: result.output }, result.totalUsage);
          } catch (error) {
            if (NoObjectGeneratedError.isInstance(error)) {
              return json(
                {
                  error: 'structured output validation failed',
                  cause:
                    error.cause instanceof Error
                      ? error.cause.message
                      : String(error.cause ?? error.message),
                },
                { status: 400 },
              );
            }
            throw error;
          }
        }

        const result = await generateText({
          model: models.language,
          ...(typeof content === 'string'
            ? { prompt: content }
            : { messages: [{ role: 'user', content }] }),
          ...temperature,
          ...maxTokens,
        });
        return respond({ text: result.text }, result.totalUsage);
      }
      case '/generate-image': {
        const body = await readJsonBody(request);
        const prompt = readPrompt(body);
        if (!prompt) {
          return json({ error: 'prompt required' }, { status: 400 });
        }
        const result = await generateImage({
          model: requireImageModel(models),
          prompt,
        });
        const first = result.images[0];
        return respond({
          stub: models.mode === 'mock',
          mediaType: first?.mediaType ?? 'image/png',
          base64: first
            ? Buffer.from(first.uint8Array).toString('base64')
            : null,
        });
      }
      case '/embed': {
        const body = await readJsonBody(request);
        const value =
          typeof body?.value === 'string'
            ? body.value
            : typeof body?.text === 'string'
              ? body.text
              : null;
        if (!value) {
          return json({ error: 'value required' }, { status: 400 });
        }
        const result = await embed({
          model: requireEmbeddingModel(models),
          value,
        });
        return respond(
          { embedding: result.embedding, stub: models.mode === 'mock' },
          result.usage,
        );
      }
      case '/chat': {
        const body = await readJsonBody(request);
        const prompt = readPrompt(body);
        if (!prompt) {
          return json({ error: 'prompt required' }, { status: 400 });
        }
        const registry =
          body?.registry &&
          typeof body.registry === 'object' &&
          !Array.isArray(body.registry)
            ? (body.registry as Awaited<ReturnType<typeof fetchAgentRegistry>>)
            : await fetchAgentRegistry(ctx.gatewayUrl, fetchImpl);
        const result = await runChat({
          prompt,
          models,
          gatewayUrl: ctx.gatewayUrl,
          registry,
          fetchImpl,
        });
        return respond(
          { text: result.text, toolNames: result.toolNames },
          result.usage,
        );
      }
      default:
        return json({ error: 'not found' }, { status: 404 });
    }
  } catch (error) {
    const { status, body } = aiErrorResponse(error, resolved.models.provider);
    return json(body, {
      status,
      headers: { [AI_SOURCE_HEADER]: resolved.source },
    });
  }
}
