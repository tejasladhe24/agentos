import { json, parseChannel, parseVars, readJsonBody, unavailable } from './http';
import type { NotificationProviders } from './providers/create-providers';
import type { NotificationType, NotifyStore } from './notify-store';
import { renderNotificationContent } from './templates/render';

export type NotifyRouteDeps = {
  store: NotifyStore;
  providers?: NotificationProviders;
};

export type NotifyRouteHandler = (
  deps: NotifyRouteDeps,
  request: Request,
) => Promise<Response>;

export async function handleHealth(): Promise<Response> {
  return json({ ok: true, backend: 'db-store' });
}

export async function handleRecent(
  deps: NotifyRouteDeps,
): Promise<Response> {
  try {
    return json({ notifications: await deps.store.list() });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleGetDelivery(
  deps: NotifyRouteDeps,
  _request: Request,
  deliveryId: string,
): Promise<Response> {
  try {
    const entry = await deps.store.get(deliveryId);
    if (!entry) {
      return json({ error: 'not found' }, { status: 404 });
    }
    return json({ notification: entry });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleNotify(
  deps: NotifyRouteDeps,
  request: Request,
): Promise<Response> {
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
  const subject = typeof body?.subject === 'string' ? body.subject : undefined;
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
    let entry = await deps.store.enqueue({
      message: rendered.value.body,
      type,
      channel,
      to: to || undefined,
      templateId: rendered.value.templateId,
      subject: rendered.value.subject,
      orgId: orgId || undefined,
    });

    if (channel === 'in_app') {
      entry = await deps.store.markStatus(entry.id, 'sent');
      return json({ ok: true, notification: entry });
    }

    const provider =
      channel === 'email' ? deps.providers?.email : deps.providers?.sms;
    if (!provider) {
      entry = await deps.store.markStatus(entry.id, 'failed', {
        error: `no ${channel} provider configured`,
      });
      return json({ ok: true, notification: entry });
    }

    const result = await provider.send({
      to,
      subject: rendered.value.subject,
      body: rendered.value.body,
    });

    entry = await deps.store.markStatus(
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

export const NOTIFY_EXACT_ROUTES: ReadonlyArray<{
  method: string;
  path: string;
  handle: NotifyRouteHandler;
}> = [
  { method: 'GET', path: '/health', handle: () => handleHealth() },
  { method: 'GET', path: '/recent', handle: (d) => handleRecent(d) },
  { method: 'POST', path: '/notify', handle: (d, r) => handleNotify(d, r) },
];
