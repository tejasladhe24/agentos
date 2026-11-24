import type { IntegrationsKit } from '@agentos/core/api/integrations';

import type { AddressStore } from './address-store';
import {
  checkEmailPermission,
  type PermissionResult,
} from './check-permission';
import {
  MESSAGES_PAGE_MAX,
  PERMISSION_EMAIL_READ,
  PERMISSION_EMAIL_SEND,
} from './constants';
import { isValidConnectionId, type ConnectionStore } from './connection-store';
import { IngestError, ingestInboundEmail, type IngestDeps } from './ingest';
import { json, unavailable } from './http';
import { EMAIL_RECEIVE_INTEGRATION } from './integrations';
import type { MessageDb } from './message-store';
import { createResendInboundProvider } from './providers/resend';
import {
  ProviderUpstreamError,
  type InboundEmailProvider,
} from './providers/types';
import {
  resolveOrgForInboundEmailRequest,
  type ResolveOrgResult,
} from './resolve-org';

export type InboundEmailDeps = IngestDeps & {
  addresses: AddressStore;
  messages: MessageDb;
  /** Platform-default provider (`AGENT_OS_EXT_INBOUND_EMAIL_PROVIDER`). */
  provider: InboundEmailProvider;
  /** BYOK webhook connection directory (`/webhooks/resend/:connectionId`). */
  connections?: ConnectionStore;
  integrations?: Pick<IntegrationsKit, 'getIntegration'>;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  runtimeEnv?: Record<string, string | undefined>;
  resolveOrg?: (
    request: Request,
    env?: Record<string, string | undefined>,
  ) => Promise<ResolveOrgResult>;
  checkPermission?: (
    request: Request,
    permission: string,
    env?: Record<string, string | undefined>,
  ) => Promise<PermissionResult>;
};

async function ensureOrg(
  deps: InboundEmailDeps,
  request: Request,
): Promise<ResolveOrgResult> {
  const resolve = deps.resolveOrg ?? resolveOrgForInboundEmailRequest;
  return resolve(request, deps.runtimeEnv ?? Bun.env);
}

async function ensurePermission(
  deps: InboundEmailDeps,
  request: Request,
  org: Extract<ResolveOrgResult, { ok: true }>,
  permission: string,
): Promise<Response | null> {
  if (org.via === 'header') return null;
  const check = deps.checkPermission ?? checkEmailPermission;
  const result = await check(request, permission, deps.runtimeEnv ?? Bun.env);
  if (result === 'unauthenticated') {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (result === 'denied') {
    return json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function handleHealth(deps: InboundEmailDeps): Promise<Response> {
  return json({
    ok: true,
    provider: deps.provider.name,
    backend: 'db-store',
  });
}

export async function handleListAddresses(
  deps: InboundEmailDeps,
  request: Request,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  const denied = await ensurePermission(
    deps,
    request,
    org,
    PERMISSION_EMAIL_READ,
  );
  if (denied) return denied;
  try {
    const addresses = await deps.addresses.list(org.orgId);
    return json({ addresses });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleProvisionAddress(
  deps: InboundEmailDeps,
  request: Request,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  const denied = await ensurePermission(
    deps,
    request,
    org,
    PERMISSION_EMAIL_SEND,
  );
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const purpose =
    typeof body.purpose === 'string' ? body.purpose.trim() : undefined;
  // Session path always binds to active org; peer header may pass body.orgId
  // only when it matches the trusted header org.
  const bodyOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
  const orgId =
    org.via === 'session'
      ? org.orgId
      : bodyOrgId && bodyOrgId === org.orgId
        ? bodyOrgId
        : org.orgId;

  if (!address) {
    return json({ error: 'address_required' }, { status: 400 });
  }
  try {
    const row = await deps.addresses.provision({ address, orgId, purpose });
    return json({ ok: true, address: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already mapped')) {
      return json(
        { error: 'address_conflict', detail: message },
        { status: 409 },
      );
    }
    return unavailable(error);
  }
}

export async function handleListMessages(
  deps: InboundEmailDeps,
  request: Request,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  const denied = await ensurePermission(
    deps,
    request,
    org,
    PERMISSION_EMAIL_READ,
  );
  if (denied) return denied;

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? MESSAGES_PAGE_MAX);
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const q = url.searchParams.get('q') ?? undefined;

  try {
    const messages = await deps.messages.list({
      orgId: org.orgId,
      limit: Number.isFinite(limitRaw) ? limitRaw : MESSAGES_PAGE_MAX,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
      from: from || undefined,
      to: to || undefined,
      q: q || undefined,
    });
    return json({ messages });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleGetMessage(
  deps: InboundEmailDeps,
  request: Request,
  messageId: string,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  const denied = await ensurePermission(
    deps,
    request,
    org,
    PERMISSION_EMAIL_READ,
  );
  if (denied) return denied;

  try {
    const message = await deps.messages.getById(org.orgId, messageId);
    if (!message) {
      return json({ error: 'not found' }, { status: 404 });
    }
    return json({ message });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handlePatchMessage(
  deps: InboundEmailDeps,
  request: Request,
  messageId: string,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  const denied = await ensurePermission(
    deps,
    request,
    org,
    PERMISSION_EMAIL_READ,
  );
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }
  if (body.read !== true) {
    return json({ error: 'read_true_required' }, { status: 400 });
  }

  try {
    const message = await deps.messages.markRead(org.orgId, messageId);
    if (!message) {
      return json({ error: 'not found' }, { status: 404 });
    }
    return json({ message });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleWebhook(
  deps: InboundEmailDeps,
  request: Request,
  provider: InboundEmailProvider = deps.provider,
  target: { orgId?: string } = {},
): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'invalid_body' }, { status: 400 });
  }

  const verifyInput = { rawBody, headers: request.headers };
  let verified = false;
  try {
    verified = await provider.verify(verifyInput);
  } catch (error) {
    return unavailable(error);
  }
  if (!verified) {
    return json({ error: 'signature' }, { status: 401 });
  }

  let email;
  try {
    email = await provider.parse(verifyInput);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof ProviderUpstreamError) {
      return json({ error: 'provider_unavailable', detail }, { status: 502 });
    }
    return json({ error: 'invalid_payload', detail }, { status: 400 });
  }
  if (!email) return json({ ok: true, ignored: true });

  try {
    const result = await ingestInboundEmail(deps, email, target);
    return json(result);
  } catch (error) {
    if (error instanceof IngestError) {
      const status = error.code === 'unknown_recipient' ? 404 : 400;
      return json({ error: error.code, detail: error.message }, { status });
    }
    return unavailable(error);
  }
}

/** Platform route bound to one provider name (`/webhooks/<name>`). */
function handleNamedWebhook(name: string) {
  return (deps: InboundEmailDeps, request: Request) =>
    deps.provider.name === name
      ? handleWebhook(deps, request)
      : Promise.resolve(
          json({ error: `provider ${name} not enabled` }, { status: 404 }),
        );
}

/**
 * BYOK Resend webhook: the opaque connection id selects the org and its
 * `email.receive` record (signing secret + API key). Mail lands in that org
 * regardless of the address directory.
 */
export async function handleResendConnectionWebhook(
  deps: InboundEmailDeps,
  request: Request,
  connectionId: string,
): Promise<Response> {
  const notFound = () => json({ error: 'unknown_connection' }, { status: 404 });
  if (!deps.connections || !deps.integrations) return notFound();
  if (!isValidConnectionId(connectionId)) return notFound();
  let config;
  let orgId: string;
  try {
    const connection = await deps.connections.get(connectionId);
    if (!connection) return notFound();
    orgId = connection.orgId;
    config = await deps.integrations.getIntegration(
      orgId,
      EMAIL_RECEIVE_INTEGRATION,
      connection.instanceId || undefined,
    );
  } catch (error) {
    return unavailable(error);
  }
  if (
    !config ||
    config.provider !== 'resend' ||
    config.settings.connectionId !== connectionId
  ) {
    return notFound();
  }
  const provider = createResendInboundProvider({
    signingSecret: config.secrets.signingSecret ?? '',
    apiKey: config.secrets.apiKey ?? '',
    fetchImpl: deps.fetchImpl,
  });
  return handleWebhook(deps, request, provider, { orgId });
}

export function parseResendConnectionId(path: string): string | null {
  const match = path.match(/^\/webhooks\/resend\/([^/]+)$/);
  return match?.[1] ?? null;
}

type ExactRoute = {
  method: string;
  path: string;
  handle: (deps: InboundEmailDeps, request: Request) => Promise<Response>;
};

export const EXACT_ROUTES: ExactRoute[] = [
  { method: 'GET', path: '/health', handle: (d) => handleHealth(d) },
  {
    method: 'GET',
    path: '/addresses',
    handle: (d, r) => handleListAddresses(d, r),
  },
  {
    method: 'POST',
    path: '/addresses',
    handle: (d, r) => handleProvisionAddress(d, r),
  },
  {
    method: 'GET',
    path: '/messages',
    handle: (d, r) => handleListMessages(d, r),
  },
  {
    method: 'POST',
    path: '/webhooks/inbound',
    handle: (d, r) => handleWebhook(d, r),
  },
  {
    method: 'POST',
    path: '/webhooks/resend',
    handle: handleNamedWebhook('resend'),
  },
  {
    method: 'POST',
    path: '/webhooks/fixture',
    handle: handleNamedWebhook('fixture'),
  },
];

export function parseMessageId(path: string): string | null {
  const match = path.match(/^\/messages\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
