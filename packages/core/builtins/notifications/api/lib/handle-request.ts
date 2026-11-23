import type { NotificationProviders } from './providers/create-providers';
import type {
  DeliveryChannel,
  NotificationType,
  NotifyStore,
} from './notify-store';
import { renderNotificationContent } from './templates/render';

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

function unavailable(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json(
    { error: 'db-store unavailable', detail: message },
    { status: 502 },
  );
}

function parseChannel(raw: unknown): DeliveryChannel | null {
  if (raw === undefined || raw === null || raw === '') return 'in_app';
  if (raw === 'in_app' || raw === 'email' || raw === 'sms') return raw;
  return null;
}

function parseVars(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Thin Bun request router for `/api/ext/notifications/*` upstream paths.
 * Persistence goes through db-store only (ADR 004).
 */
export async function handleNotificationsRequest(
  store: NotifyStore,
  request: Request,
  providers?: NotificationProviders,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/health') {
    return json({ ok: true, backend: 'db-store' });
  }

  if (method === 'GET' && path === '/recent') {
    try {
      return json({ notifications: await store.list() });
    } catch (error) {
      return unavailable(error);
    }
  }

  const deliveryMatch = path.match(/^\/deliveries\/([^/]+)$/);
  if (method === 'GET' && deliveryMatch) {
    const id = decodeURIComponent(deliveryMatch[1]!);
    try {
      const entry = await store.get(id);
      if (!entry) {
        return json({ error: 'not found' }, { status: 404 });
      }
      return json({ notification: entry });
    } catch (error) {
      return unavailable(error);
    }
  }

  if (method === 'POST' && path === '/notify') {
    const body = await readJsonBody(request);
    const channel = parseChannel(body?.channel);
    if (!channel) {
      return json(
        { error: 'channel must be in_app | email | sms' },
        { status: 400 },
      );
    }

    const typeRaw = body?.type;
    const type: NotificationType =
      typeRaw === 'success' || typeRaw === 'error' || typeRaw === 'info'
        ? typeRaw
        : 'info';

    const templateId =
      typeof body?.templateId === 'string' ? body.templateId.trim() : undefined;
    const subject =
      typeof body?.subject === 'string' ? body.subject : undefined;
    const messageRaw =
      typeof body?.message === 'string' ? body.message : undefined;
    const vars = parseVars(body?.vars);
    const to = typeof body?.to === 'string' ? body.to.trim() : '';
    const orgId =
      typeof body?.orgId === 'string'
        ? body.orgId.trim()
        : (request.headers.get('x-agentos-org-id')?.trim() ?? undefined);

    const rendered = renderNotificationContent({
      message: messageRaw,
      subject,
      templateId: templateId || undefined,
      vars,
    });
    if (!rendered.ok) {
      return json({ error: rendered.error }, { status: 400 });
    }

    if (channel !== 'in_app' && !to) {
      return json({ error: 'to required for email | sms' }, { status: 400 });
    }

    try {
      let entry = await store.enqueue({
        message: rendered.value.body,
        type,
        channel,
        to: to || undefined,
        templateId: rendered.value.templateId,
        subject: rendered.value.subject,
        orgId: orgId || undefined,
      });

      if (channel === 'in_app') {
        entry = await store.markStatus(entry.id, 'sent');
        return json({ ok: true, notification: entry });
      }

      const provider = channel === 'email' ? providers?.email : providers?.sms;
      if (!provider) {
        entry = await store.markStatus(entry.id, 'failed', {
          error: `no ${channel} provider configured`,
        });
        return json({ ok: true, notification: entry });
      }

      const result = await provider.send({
        to,
        subject: rendered.value.subject,
        body: rendered.value.body,
      });

      entry = await store.markStatus(
        entry.id,
        result.ok ? 'sent' : 'failed',
        result.ok
          ? { provider: result.provider }
          : { provider: result.provider, error: result.error },
      );
      return json({ ok: true, notification: entry });
    } catch (error) {
      return unavailable(error);
    }
  }

  return json({ error: 'not found' }, { status: 404 });
}
