import {
  handleIntegrationRoutes,
  PERMISSION_INTEGRATIONS_MANAGE,
  type IntegrationDefinition,
  type IntegrationRoutesContext,
} from '@agentos/core/api/integrations';

import {
  AI_INTEGRATION_ID,
  aiConfigFromIntegration,
  embeddingIdentity,
} from './ai-integration';
import type { AiModels } from './create-model';
import type { FetchLike } from './fetch-like';
import { AiCatalogError, listProviderModels } from './model-catalog';
import { AiConfigError, isAiProviderId } from './providers';

export type AiIntegrationRoutesContext = Omit<
  IntegrationRoutesContext,
  'definitions' | 'basePath'
> & {
  definition: IntegrationDefinition;
  platform: AiModels;
  /** Vectors the org has stored in vector-store (all indexes). */
  countVectors: (orgId: string) => Promise<number>;
  fetchImpl?: FetchLike;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringSetting(settings: unknown, name: string): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const value = (settings as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const AI_BASE = `/integrations/${AI_INTEGRATION_ID}`;
const AI_RECORD_PATH = new RegExp(`^${AI_BASE}(?:/default)?$`);

type ManagedOrg =
  { ok: true; orgId: string } | { ok: false; response: Response | null };

/**
 * Org + `integrations.manage` gate. `response: null` lets the shared routes
 * produce their own error for the same request.
 */
async function manageOrg(
  ctx: AiIntegrationRoutesContext,
  request: Request,
  passthrough: boolean,
): Promise<ManagedOrg> {
  const org = await ctx.resolveOrg(request);
  if (!org.ok) {
    return {
      ok: false,
      response: passthrough
        ? null
        : json({ error: org.error }, { status: org.status }),
    };
  }
  if (org.via !== 'header') {
    const result = await ctx.checkPermission(
      request,
      PERMISSION_INTEGRATIONS_MANAGE,
    );
    if (result !== 'ok') {
      if (passthrough) return { ok: false, response: null };
      return {
        ok: false,
        response: json(
          {
            error:
              result === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
          },
          { status: result === 'unauthenticated' ? 401 : 403 },
        ),
      };
    }
  }
  return { ok: true, orgId: org.orgId };
}

async function currentEmbeddingIdentity(
  ctx: AiIntegrationRoutesContext,
  orgId: string,
): Promise<string | null> {
  const saved = await ctx.kit.describeIntegration(orgId, AI_INTEGRATION_ID);
  if (saved) {
    return embeddingIdentity(
      saved.provider,
      stringSetting(saved.settings, 'embeddingModel'),
    );
  }
  return platformEmbeddingIdentity(ctx.platform);
}

function platformEmbeddingIdentity(platform: AiModels): string | null {
  return embeddingIdentity(platform.provider, platform.embeddingModel);
}

/**
 * Vectors are only comparable within one embedding model, so switching while
 * the org has stored vectors is refused (re-embed or delete them first).
 */
async function guardEmbeddingChange(
  ctx: AiIntegrationRoutesContext,
  orgId: string,
  next: string | null,
): Promise<Response | null> {
  const current = await currentEmbeddingIdentity(ctx, orgId);
  if (!current || !next || current === next) return null;
  let vectors: number;
  try {
    vectors = await ctx.countVectors(orgId);
  } catch {
    return json(
      {
        error:
          'Could not check stored vectors before changing the embedding model. Try again.',
        code: 'ai_embedding_check_failed',
      },
      { status: 503 },
    );
  }
  if (vectors === 0) return null;
  return json(
    {
      error: `This org has ${vectors} stored vector${vectors === 1 ? '' : 's'} embedded with ${current}. Switching to ${next} would make them unsearchable. Delete or re-embed them before changing the embedding model.`,
      code: 'ai_embedding_model_locked',
      vectors,
      current,
      next,
    },
    { status: 409 },
  );
}

async function handleModels(
  ctx: AiIntegrationRoutesContext,
  request: Request,
): Promise<Response> {
  const gate = await manageOrg(ctx, request, false);
  if (!gate.ok) return gate.response as Response;
  const body = await readBody(request);
  if (!isAiProviderId(body.provider)) {
    return json({ error: 'unknown provider' }, { status: 400 });
  }
  let apiKey =
    typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : undefined;
  let baseUrl = stringSetting(body, 'baseUrl');
  if (!apiKey) {
    const saved = await ctx.kit.getIntegration(gate.orgId, AI_INTEGRATION_ID);
    if (saved?.provider === body.provider) {
      apiKey = saved.secrets.apiKey;
      baseUrl ??= stringSetting(saved.settings, 'baseUrl');
    }
  }
  if (baseUrl && !URL.canParse(baseUrl)) {
    return json({ error: 'Base URL must be an absolute URL' }, { status: 400 });
  }
  try {
    const models = await listProviderModels({
      provider: body.provider,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    });
    return json({ provider: body.provider, models });
  } catch (error) {
    if (error instanceof AiCatalogError) {
      return json({ error: error.message }, { status: error.status });
    }
    return json({ error: 'Could not reach the provider' }, { status: 502 });
  }
}

async function handleEmbeddingStatus(
  ctx: AiIntegrationRoutesContext,
  request: Request,
): Promise<Response> {
  const org = await ctx.resolveOrg(request);
  if (!org.ok) return json({ error: org.error }, { status: org.status });
  const current = await currentEmbeddingIdentity(ctx, org.orgId);
  let vectors: number | null = null;
  try {
    vectors = await ctx.countVectors(org.orgId);
  } catch {
    // unknown; the guard re-checks on save
  }
  return json({
    current,
    platform: platformEmbeddingIdentity(ctx.platform),
    vectors,
    locked: Boolean(current && vectors),
  });
}

/**
 * AI builtin integration routes: the shared `/integrations/*` CRUD + test,
 * plus provider-config validation, the embedding-model guard, the model
 * catalog (`POST /integrations/ai/models`) and
 * `GET /integrations/ai/embedding-status`.
 */
export async function handleAiIntegrationRoutes(
  ctx: AiIntegrationRoutesContext,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const shared: IntegrationRoutesContext = {
    kit: ctx.kit,
    definitions: [ctx.definition],
    resolveOrg: ctx.resolveOrg,
    checkPermission: ctx.checkPermission,
  };

  try {
    if (path === `${AI_BASE}/models` && method === 'POST') {
      return await handleModels(ctx, request);
    }
    if (path === `${AI_BASE}/embedding-status` && method === 'GET') {
      return await handleEmbeddingStatus(ctx, request);
    }

    if (
      AI_RECORD_PATH.test(path) &&
      (method === 'PUT' || method === 'DELETE')
    ) {
      const gate = await manageOrg(ctx, request, true);
      if (gate.ok) {
        let next: string | null;
        if (method === 'PUT') {
          const body = await readBody(request.clone());
          if (typeof body.provider !== 'string') {
            return handleIntegrationRoutes(shared, request);
          }
          try {
            aiConfigFromIntegration({
              provider: body.provider,
              settings:
                body.settings && typeof body.settings === 'object'
                  ? (body.settings as Record<string, unknown>)
                  : {},
              // key presence is enforced by the shared draft validation
              secrets: { apiKey: 'unchecked' },
            });
          } catch (error) {
            if (error instanceof AiConfigError) {
              return json({ error: error.message }, { status: 400 });
            }
            throw error;
          }
          next = embeddingIdentity(
            body.provider,
            stringSetting(body.settings, 'embeddingModel'),
          );
        } else {
          next = platformEmbeddingIdentity(ctx.platform);
        }
        const blocked = await guardEmbeddingChange(ctx, gate.orgId, next);
        if (blocked) return blocked;
      }
    }
  } catch {
    return json({ error: 'integration backend unavailable' }, { status: 502 });
  }

  return handleIntegrationRoutes(shared, request);
}
