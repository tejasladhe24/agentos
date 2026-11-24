import type { FetchLike } from './fetch-like';
import type { AiProviderId } from './providers';

export type AiModelCatalog = {
  language: string[];
  embedding: string[];
  image: string[];
};

export class AiCatalogError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiCatalogError';
  }
}

const DEFAULT_BASES: Record<AiProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  'ai-gateway': 'https://ai-gateway.vercel.sh/v1',
};

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { headers });
  if (res.status === 401 || res.status === 403) {
    throw new AiCatalogError('The provider rejected the API key', 502);
  }
  if (!res.ok) {
    throw new AiCatalogError(
      `The provider model list failed (HTTP ${res.status})`,
      502,
    );
  }
  const body = (await res.json()) as unknown;
  if (!body || typeof body !== 'object') {
    throw new AiCatalogError(
      'The provider returned an invalid model list',
      502,
    );
  }
  return body as Record<string, unknown>;
}

function dataIds(
  body: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const data = Array.isArray(body.data) ? body.data : [];
  return data.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && typeof item.id === 'string',
  );
}

function classifyOpenAi(ids: string[]): AiModelCatalog {
  const language: string[] = [];
  const embedding: string[] = [];
  const image: string[] = [];
  for (const id of ids) {
    if (id.includes('embedding')) embedding.push(id);
    else if (id.startsWith('dall-e') || id.startsWith('gpt-image')) {
      image.push(id);
    } else if (/^(gpt-|o\d|chatgpt-)/.test(id)) {
      if (!/(audio|realtime|transcribe|tts|search)/.test(id)) language.push(id);
    }
  }
  return {
    language: sorted(language),
    embedding: sorted(embedding),
    image: sorted(image),
  };
}

/**
 * List the models an API key can use, grouped by capability. The AI Gateway
 * catalog is public; every other provider needs `apiKey`.
 */
export async function listProviderModels(input: {
  provider: AiProviderId;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}): Promise<AiModelCatalog> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = (
    input.provider === 'ai-gateway'
      ? DEFAULT_BASES['ai-gateway']
      : (input.baseUrl ?? DEFAULT_BASES[input.provider])
  ).replace(/\/+$/, '');
  if (!input.apiKey && input.provider !== 'ai-gateway') {
    throw new AiCatalogError('An API key is required to list models', 400);
  }
  const apiKey = input.apiKey ?? '';

  switch (input.provider) {
    case 'openai': {
      const body = await getJson(fetchImpl, `${base}/models`, {
        authorization: `Bearer ${apiKey}`,
      });
      return classifyOpenAi(dataIds(body).map((m) => m.id as string));
    }
    case 'anthropic': {
      const body = await getJson(fetchImpl, `${base}/models?limit=1000`, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      });
      return {
        language: sorted(dataIds(body).map((m) => m.id as string)),
        embedding: [],
        image: [],
      };
    }
    case 'google': {
      const body = await getJson(fetchImpl, `${base}/models?pageSize=1000`, {
        'x-goog-api-key': apiKey,
      });
      const models = Array.isArray(body.models) ? body.models : [];
      const catalog: AiModelCatalog = {
        language: [],
        embedding: [],
        image: [],
      };
      for (const raw of models) {
        if (!raw || typeof raw !== 'object') continue;
        const model = raw as {
          name?: unknown;
          supportedGenerationMethods?: unknown;
        };
        if (typeof model.name !== 'string') continue;
        const id = model.name.replace(/^models\//, '');
        const methods = Array.isArray(model.supportedGenerationMethods)
          ? model.supportedGenerationMethods
          : [];
        if (methods.includes('embedContent')) catalog.embedding.push(id);
        else if (id.startsWith('imagen') && methods.includes('predict')) {
          catalog.image.push(id);
        } else if (methods.includes('generateContent')) {
          catalog.language.push(id);
        }
      }
      return {
        language: sorted(catalog.language),
        embedding: sorted(catalog.embedding),
        image: sorted(catalog.image),
      };
    }
    case 'ai-gateway': {
      const body = await getJson(
        fetchImpl,
        `${base}/models`,
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      );
      const catalog: AiModelCatalog = {
        language: [],
        embedding: [],
        image: [],
      };
      for (const model of dataIds(body)) {
        const id = model.id as string;
        if (model.type === 'embedding') catalog.embedding.push(id);
        else if (model.type === 'image') catalog.image.push(id);
        else if (!model.type || model.type === 'language') {
          catalog.language.push(id);
        }
      }
      return {
        language: sorted(catalog.language),
        embedding: sorted(catalog.embedding),
        image: sorted(catalog.image),
      };
    }
  }
}
