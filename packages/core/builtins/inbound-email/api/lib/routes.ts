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
import { IngestError, ingestInboundEmail, type IngestDeps } from './ingest';
import { json, unavailable } from './http';
import type { MessageDb } from './message-store';
import type { InboundEmailProvider } from './providers/types';
import {
  resolveOrgForInboundEmailRequest,
  type ResolveOrgResult,
} from './resolve-org';

export type InboundEmailDeps = IngestDeps & {
  addresses: AddressStore;
  messages: MessageDb;
  provider: InboundEmailProvider;
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
): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  let rawBody: string | Uint8Array = '';
  let form: FormData | undefined;

  try {
    if (contentType.includes('multipart/form-data')) {
      form = await request.formData();
      rawBody = '';
    } else {
      rawBody = await request.text();
    }
  } catch {
    return json({ error: 'invalid_body' }, { status: 400 });
  }

  const verifyInput = { rawBody, headers: request.headers, form };
  let verified = false;
  try {
    verified = await deps.provider.verify(verifyInput);
  } catch (error) {
    return unavailable(error);
  }
  if (!verified) {
    return json({ error: 'signature' }, { status: 401 });
  }

  let email;
  try {
    email = await deps.provider.parse(verifyInput);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: 'invalid_payload', detail }, { status: 400 });
  }

  try {
    const result = await ingestInboundEmail(deps, email);
    return json(result);
  } catch (error) {
    if (error instanceof IngestError) {
      const status = error.code === 'unknown_recipient' ? 404 : 400;
      return json({ error: error.code, detail: error.message }, { status });
    }
    return unavailable(error);
  }
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
    path: '/webhooks/mailgun',
    handle: (d, r) => handleWebhook(d, r),
  },
  {
    method: 'POST',
    path: '/webhooks/fixture',
    handle: (d, r) => handleWebhook(d, r),
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
