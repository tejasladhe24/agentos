import {
  embed,
  generateImage,
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
} from 'ai';

import type { AiModels } from './create-model';
import type { FetchLike } from './fetch-like';
import {
  isResolveAttachmentsError,
  resolveAttachments,
  type ResolvedAttachment,
} from './resolve-attachments';
import { fetchAgentRegistry, runChat } from './run-chat';

export type AiHandlerContext = {
  models: AiModels;
  gatewayUrl: string;
  fetchImpl?: FetchLike;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

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
    return json({ ok: true, mode: ctx.models.mode });
  }

  if (method !== 'POST') {
    return json({ error: 'not found' }, { status: 404 });
  }

  try {
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
              model: ctx.models.language,
              messages: [{ role: 'user', content }],
              output: Output.object({
                schema: jsonSchema(schema),
              }),
              ...temperature,
              ...maxTokens,
            });
            return json({ object: result.output });
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
          model: ctx.models.language,
          ...(typeof content === 'string'
            ? { prompt: content }
            : { messages: [{ role: 'user', content }] }),
          ...temperature,
          ...maxTokens,
        });
        return json({ text: result.text });
      }
      case '/generate-image': {
        const body = await readJsonBody(request);
        const prompt = readPrompt(body);
        if (!prompt) {
          return json({ error: 'prompt required' }, { status: 400 });
        }
        const result = await generateImage({
          model: ctx.models.image,
          prompt,
        });
        const first = result.images[0];
        return json({
          stub: ctx.models.mode === 'mock',
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
          model: ctx.models.embedding,
          value,
        });
        return json({
          embedding: result.embedding,
          stub: ctx.models.mode === 'mock',
        });
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
          models: ctx.models,
          gatewayUrl: ctx.gatewayUrl,
          registry,
          fetchImpl,
        });
        return json({
          text: result.text,
          toolNames: result.toolNames,
        });
      }
      default:
        return json({ error: 'not found' }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, { status: 500 });
  }
}
