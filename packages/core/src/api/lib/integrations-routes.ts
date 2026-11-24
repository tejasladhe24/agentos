/**
 * Shared `/integrations/*` route handler that builtins mount for their
 * Settings sections (ticket 103). Validates input against an
 * `IntegrationDefinition`, enforces `integrations.manage`, and never returns
 * secret values.
 */

import type { EnvMap } from './http';
import {
  DEFAULT_INTEGRATION_INSTANCE,
  IntegrationError,
  isValidInstanceId,
  PERMISSION_INTEGRATIONS_MANAGE,
  type IntegrationsKit,
  type IntegrationView,
  type ResolvedIntegration,
} from './integrations';

export type IntegrationFieldDefinition = {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
};

export type IntegrationProviderDefinition = {
  id: string;
  label: string;
  description?: string;
  settings?: IntegrationFieldDefinition[];
  secrets?: IntegrationFieldDefinition[];
};

export type IntegrationTestResult = { ok: boolean; message?: string };

export type IntegrationDefinition = {
  /** Namespaced id, e.g. `email.send`. */
  id: string;
  label: string;
  description?: string;
  /** Allow several instances per org (e.g. file mounts). */
  multiInstance?: boolean;
  providers: IntegrationProviderDefinition[];
  /** Describe the platform env fallback shown when the org has no record. */
  platformDefault?: () => { provider: string; configured: boolean };
  /**
   * Probe a provider. `config` is the saved (or draft) tenant config, or
   * `null` to test the platform default.
   */
  test?: (input: {
    orgId: string;
    config: ResolvedIntegration | null;
    /** Session user (email when known) — e.g. recipient of a test message. */
    actor?: string;
  }) => Promise<IntegrationTestResult>;
};

export type IntegrationOrgResult =
  | { ok: true; orgId: string; via: 'session' | 'header'; actor?: string }
  | { ok: false; status: number; error: string };

export type IntegrationRoutesContext = {
  kit: IntegrationsKit;
  definitions: IntegrationDefinition[];
  resolveOrg: (request: Request) => Promise<IntegrationOrgResult>;
  checkPermission: (
    request: Request,
    permission: string,
  ) => Promise<'ok' | 'unauthenticated' | 'denied'>;
  /** Mount path inside the builtin API (default `/integrations`). */
  basePath?: string;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function publicDefinition(def: IntegrationDefinition) {
  return {
    id: def.id,
    label: def.label,
    description: def.description,
    multiInstance: Boolean(def.multiInstance),
    testable: Boolean(def.test),
    providers: def.providers.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      settings: p.settings ?? [],
      secrets: p.secrets ?? [],
    })),
  };
}

function redact(message: string, secrets: Record<string, string>): string {
  let out = message;
  for (const value of Object.values(secrets)) {
    if (value && value.length >= 4) out = out.split(value).join('••••');
  }
  return out;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // empty / invalid body
  }
  return {};
}

type ParsedPath = {
  integration?: string;
  instanceId?: string;
  test: boolean;
};

function parsePath(path: string, base: string): ParsedPath | null {
  if (path === base) return { test: false };
  if (!path.startsWith(`${base}/`)) return null;
  const parts = path
    .slice(base.length + 1)
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const test = parts[parts.length - 1] === 'test';
  if (test) parts.pop();
  if (parts.length < 1 || parts.length > 2) return null;
  return { integration: parts[0], instanceId: parts[1], test };
}

type DraftValidation =
  | {
      ok: true;
      provider: string;
      settings: Record<string, unknown>;
      secrets: Record<string, string | null>;
    }
  | { ok: false; error: string };

function validateDraft(
  def: IntegrationDefinition,
  body: Record<string, unknown>,
  existing: IntegrationView | null,
  partialSecretsOk: boolean,
): DraftValidation {
  const providerId = typeof body.provider === 'string' ? body.provider : '';
  const provider = def.providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: 'unknown provider' };

  const rawSettings =
    body.settings &&
    typeof body.settings === 'object' &&
    !Array.isArray(body.settings)
      ? (body.settings as Record<string, unknown>)
      : {};
  const settingFields = provider.settings ?? [];
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawSettings)) {
    if (!settingFields.some((f) => f.name === key)) {
      return { ok: false, error: `unknown setting: ${key}` };
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) settings[key] = trimmed;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      settings[key] = value;
    } else if (value !== null && value !== undefined) {
      return { ok: false, error: `invalid setting: ${key}` };
    }
  }
  for (const field of settingFields) {
    if (field.required && settings[field.name] === undefined) {
      return { ok: false, error: `${field.label} is required` };
    }
  }

  const rawSecrets =
    body.secrets &&
    typeof body.secrets === 'object' &&
    !Array.isArray(body.secrets)
      ? (body.secrets as Record<string, unknown>)
      : {};
  const secretFields = provider.secrets ?? [];
  const secrets: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(rawSecrets)) {
    if (!secretFields.some((f) => f.name === key)) {
      return { ok: false, error: `unknown secret: ${key}` };
    }
    if (value === null) {
      secrets[key] = null;
    } else if (typeof value === 'string' && value.length > 0) {
      secrets[key] = value;
    } else if (value !== undefined && value !== '') {
      return { ok: false, error: `invalid secret: ${key}` };
    }
  }
  const sameProvider = existing?.provider === provider.id;
  if (!partialSecretsOk) {
    for (const field of secretFields) {
      if (!field.required) continue;
      const supplied = typeof secrets[field.name] === 'string';
      const kept =
        sameProvider &&
        existing?.secrets[field.name]?.set === true &&
        secrets[field.name] !== null;
      if (!supplied && !kept) {
        return { ok: false, error: `${field.label} is required` };
      }
    }
  }
  return { ok: true, provider: provider.id, settings, secrets };
}

/**
 * Handle `/integrations[/:integration[/:instanceId]][/test]`.
 * Returns `null` when the path is not an integrations route.
 */
export async function handleIntegrationRoutes(
  ctx: IntegrationRoutesContext,
  request: Request,
): Promise<Response | null> {
  const base = ctx.basePath ?? '/integrations';
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const parsed = parsePath(path, base);
  if (!parsed) return null;
  const method = request.method.toUpperCase();

  const org = await ctx.resolveOrg(request);
  if (!org.ok) return json({ error: org.error }, { status: org.status });

  const canManage = async (): Promise<boolean | Response> => {
    if (org.via === 'header') return true;
    const result = await ctx.checkPermission(
      request,
      PERMISSION_INTEGRATIONS_MANAGE,
    );
    if (result === 'unauthenticated') {
      return json({ error: 'unauthenticated' }, { status: 401 });
    }
    return result === 'ok';
  };

  const describe = async (def: IntegrationDefinition) => {
    const instances = await ctx.kit.listIntegrations(org.orgId, def.id);
    return {
      definition: publicDefinition(def),
      platformDefault: def.platformDefault?.() ?? null,
      instances,
    };
  };

  try {
    if (!parsed.integration) {
      if (method !== 'GET') {
        return json({ error: 'method not allowed' }, { status: 405 });
      }
      const manage = await canManage();
      if (manage instanceof Response) return manage;
      const integrations = [];
      for (const def of ctx.definitions) integrations.push(await describe(def));
      return json({ orgId: org.orgId, canManage: manage, integrations });
    }

    const def = ctx.definitions.find((d) => d.id === parsed.integration);
    if (!def) return json({ error: 'unknown integration' }, { status: 404 });
    const instanceId = parsed.instanceId ?? DEFAULT_INTEGRATION_INSTANCE;
    if (!isValidInstanceId(instanceId)) {
      return json({ error: 'invalid instance id' }, { status: 400 });
    }
    if (!def.multiInstance && instanceId !== DEFAULT_INTEGRATION_INSTANCE) {
      return json(
        { error: 'integration does not support multiple instances' },
        { status: 400 },
      );
    }

    if (parsed.test) {
      if (method !== 'POST') {
        return json({ error: 'method not allowed' }, { status: 405 });
      }
      return handleTest(ctx, org, def, instanceId, request, canManage);
    }

    if (method === 'GET') {
      const manage = await canManage();
      if (manage instanceof Response) return manage;
      if (parsed.instanceId) {
        const view = await ctx.kit.describeIntegration(
          org.orgId,
          def.id,
          instanceId,
        );
        if (!view) return json({ error: 'not found' }, { status: 404 });
        return json({ canManage: manage, instance: view });
      }
      return json({
        orgId: org.orgId,
        canManage: manage,
        ...(await describe(def)),
      });
    }

    const manage = await canManage();
    if (manage instanceof Response) return manage;
    if (!manage) return json({ error: 'forbidden' }, { status: 403 });

    if (method === 'PUT') {
      const body = await readBody(request);
      const existing = await ctx.kit.describeIntegration(
        org.orgId,
        def.id,
        instanceId,
      );
      const draft = validateDraft(def, body, existing, false);
      if (!draft.ok) return json({ error: draft.error }, { status: 400 });
      const view = await ctx.kit.putIntegration(org.orgId, {
        integration: def.id,
        instanceId,
        provider: draft.provider,
        settings: draft.settings,
        secrets: draft.secrets,
        ...(org.actor ? { updatedBy: org.actor } : {}),
      });
      return json({ instance: view }, { status: existing ? 200 : 201 });
    }

    if (method === 'DELETE') {
      const result = await ctx.kit.deleteIntegration(
        org.orgId,
        def.id,
        instanceId,
        org.actor,
      );
      if (!result.deleted) return json({ error: 'not found' }, { status: 404 });
      return json(result);
    }

    return json({ error: 'method not allowed' }, { status: 405 });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return json({ error: error.message }, { status: error.status });
    }
    return json({ error: 'integration backend unavailable' }, { status: 502 });
  }
}

async function handleTest(
  ctx: IntegrationRoutesContext,
  org: Extract<IntegrationOrgResult, { ok: true }>,
  def: IntegrationDefinition,
  instanceId: string,
  request: Request,
  canManage: () => Promise<boolean | Response>,
): Promise<Response> {
  const manage = await canManage();
  if (manage instanceof Response) return manage;
  if (!manage) return json({ error: 'forbidden' }, { status: 403 });
  if (!def.test) {
    return json({ error: 'test not supported' }, { status: 400 });
  }

  const body = await readBody(request);
  const saved = await ctx.kit.getIntegration(org.orgId, def.id, instanceId);
  let config: ResolvedIntegration | null = saved;
  let source: 'tenant' | 'platform' | 'draft' = saved ? 'tenant' : 'platform';

  if (typeof body.provider === 'string') {
    const existingView = saved
      ? await ctx.kit.describeIntegration(org.orgId, def.id, instanceId)
      : null;
    const draft = validateDraft(def, body, existingView, true);
    if (!draft.ok) return json({ error: draft.error }, { status: 400 });
    const secrets: Record<string, string> = {};
    if (saved && saved.provider === draft.provider) {
      Object.assign(secrets, saved.secrets);
    }
    for (const [field, value] of Object.entries(draft.secrets)) {
      if (value === null) delete secrets[field];
      else secrets[field] = value;
    }
    config = {
      id: saved?.id ?? `${def.id}:${instanceId}`,
      integration: def.id,
      instanceId,
      provider: draft.provider,
      settings: draft.settings,
      secrets,
      updatedAt: saved?.updatedAt ?? new Date().toISOString(),
    };
    source = 'draft';
  }

  let result: IntegrationTestResult;
  try {
    result = await def.test({ orgId: org.orgId, config, actor: org.actor });
  } catch (error) {
    result = {
      ok: false,
      message: error instanceof Error ? error.message : 'test failed',
    };
  }
  const message = result.message
    ? redact(result.message, config?.secrets ?? {})
    : undefined;

  await ctx.kit.recordIntegrationTest(org.orgId, {
    integration: def.id,
    instanceId,
    provider:
      config?.provider ?? def.platformDefault?.().provider ?? 'platform',
    ok: result.ok,
    source,
    ...(org.actor ? { actor: org.actor } : {}),
  });
  return json({ ok: result.ok, source, ...(message ? { message } : {}) });
}

const DEFAULT_AUTH_BASE = 'http://127.0.0.1:6110';

function resolveAuthBase(env: EnvMap): string {
  if (env.AGENT_OS_AUTH_API_BASE) {
    return env.AGENT_OS_AUTH_API_BASE.replace(/\/$/, '');
  }
  const gateway = env.AGENT_OS_GLOBAL_GATEWAY_URL?.replace(/\/$/, '');
  return gateway ? `${gateway}/api/ext/auth` : DEFAULT_AUTH_BASE;
}

/**
 * Default org resolver for builtins: session cookie → active org (+ user id
 * as actor), else trusted peer header `X-AgentOS-Org-Id`.
 */
export function createSessionOrgResolver(
  env: EnvMap = Bun.env,
): (request: Request) => Promise<IntegrationOrgResult> {
  return async (request) => {
    const cookie = request.headers.get('cookie');
    if (cookie) {
      try {
        const res = await fetch(`${resolveAuthBase(env)}/session`, {
          headers: { cookie },
        });
        if (res.ok) {
          const body = (await res.json()) as {
            orgId?: string | null;
            user?: { id?: string; email?: string };
          };
          if (typeof body.orgId === 'string' && body.orgId) {
            const actor = body.user?.email ?? body.user?.id;
            return {
              ok: true,
              orgId: body.orgId,
              via: 'session',
              ...(actor ? { actor } : {}),
            };
          }
          return { ok: false, status: 403, error: 'active org required' };
        }
        if (res.status === 401) {
          return { ok: false, status: 401, error: 'unauthenticated' };
        }
      } catch {
        // fall through to header
      }
    }
    const header = request.headers.get('x-agentos-org-id')?.trim();
    if (header) return { ok: true, orgId: header, via: 'header' };
    return {
      ok: false,
      status: 401,
      error: 'org context required (session or X-AgentOS-Org-Id)',
    };
  };
}

/** Default permission check via builtin auth `/permissions/check`. */
export function createSessionPermissionCheck(
  env: EnvMap = Bun.env,
): (
  request: Request,
  permission: string,
) => Promise<'ok' | 'unauthenticated' | 'denied'> {
  return async (request, permission) => {
    const cookie = request.headers.get('cookie');
    if (!cookie) return 'unauthenticated';
    try {
      const res = await fetch(`${resolveAuthBase(env)}/permissions/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ permission }),
      });
      if (res.status === 401) return 'unauthenticated';
      if (!res.ok) return 'denied';
      const body = (await res.json()) as { allowed?: boolean };
      return body.allowed === true ? 'ok' : 'denied';
    } catch {
      return 'denied';
    }
  };
}
