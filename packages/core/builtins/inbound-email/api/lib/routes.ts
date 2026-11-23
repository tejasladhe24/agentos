import type { AddressStore } from './address-store';
import { IngestError, ingestInboundEmail, type IngestDeps } from './ingest';
import { json, unavailable } from './http';
import type { InboundEmailProvider } from './providers/types';

export type InboundEmailDeps = IngestDeps & {
  addresses: AddressStore;
  provider: InboundEmailProvider;
};

export async function handleHealth(deps: InboundEmailDeps): Promise<Response> {
  return json({
    ok: true,
    provider: deps.provider.name,
    backend: 'db-store',
  });
}

export async function handleListAddresses(
  deps: InboundEmailDeps,
): Promise<Response> {
  try {
    const addresses = await deps.addresses.list();
    return json({ addresses });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleProvisionAddress(
  deps: InboundEmailDeps,
  request: Request,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
  const purpose =
    typeof body.purpose === 'string' ? body.purpose.trim() : undefined;
  if (!address || !orgId) {
    return json({ error: 'address_and_orgId_required' }, { status: 400 });
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
    handle: (d) => handleListAddresses(d),
  },
  {
    method: 'POST',
    path: '/addresses',
    handle: (d, r) => handleProvisionAddress(d, r),
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
