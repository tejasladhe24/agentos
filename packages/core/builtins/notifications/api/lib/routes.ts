import {
  checkNotificationsPermission,
  type PermissionResult,
} from './check-permission';
import { PERMISSION_EMAIL_READ, PERMISSION_EMAIL_SEND } from './constants';
import {
  json,
  parseChannel,
  parseVars,
  readJsonBody,
  unavailable,
} from './http';
import type { IntegrationsKit } from '@agentos/core/api/integrations';

import {
  E164_PATTERN,
  EMAIL_SEND_INTEGRATION,
  resolveChannelProvider,
  SMS_INTEGRATION,
} from './integrations';
import type { NotificationProviders } from './providers/create-providers';
import type {
  DeliveryChannel,
  NotificationType,
  NotifyStore,
} from './notify-store';
import {
  resolveOrgForNotificationsRequest,
  type ResolveOrgResult,
} from './resolve-org';
import { renderNotificationContent } from './templates/render';
import type { UserEmailPrefsStore } from './user-email-prefs';
import type { UserSmsPrefsStore } from './user-sms-prefs';

export type NotifyRouteDeps = {
  store: NotifyStore;
  providers?: NotificationProviders;
  /** Per-org BYOK resolution (ticket 105); omit for env-only providers. */
  integrations?: IntegrationsKit;
  /** Per-user email sender preferences (ticket 128). */
  userPrefs?: UserEmailPrefsStore;
  /** Per-user SMS sender number preferences. */
  userSmsPrefs?: UserSmsPrefsStore;
  fetchImpl?: typeof fetch;
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

export type NotifyRouteHandler = (
  deps: NotifyRouteDeps,
  request: Request,
) => Promise<Response>;

async function ensureOrg(
  deps: NotifyRouteDeps,
  request: Request,
): Promise<ResolveOrgResult> {
  const resolve = deps.resolveOrg ?? resolveOrgForNotificationsRequest;
  return resolve(request, deps.runtimeEnv ?? Bun.env);
}

async function ensurePermission(
  deps: NotifyRouteDeps,
  request: Request,
  org: Extract<ResolveOrgResult, { ok: true }>,
  permission: string,
): Promise<Response | null> {
  if (org.via === 'header') return null;
  const check = deps.checkPermission ?? checkNotificationsPermission;
  const result = await check(request, permission, deps.runtimeEnv ?? Bun.env);
  if (result === 'unauthenticated') {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (result === 'denied') {
    return json({ error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function handleHealth(): Promise<Response> {
  return json({ ok: true, backend: 'db-store' });
}

export async function handleRecent(deps: NotifyRouteDeps): Promise<Response> {
  try {
    return json({ notifications: await deps.store.list() });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleListDeliveries(
  deps: NotifyRouteDeps,
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
  const channelRaw = url.searchParams.get('channel');
  let channel: DeliveryChannel | undefined;
  if (channelRaw) {
    if (
      channelRaw !== 'email' &&
      channelRaw !== 'sms' &&
      channelRaw !== 'in_app'
    ) {
      return json(
        { error: 'channel must be in_app | email | sms' },
        { status: 400 },
      );
    }
    channel = channelRaw;
  }
  const limitRaw = Number(url.searchParams.get('limit') ?? 50);
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0);

  try {
    const notifications = await deps.store.listDeliveries({
      orgId: org.orgId,
      channel,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
    });
    return json({ notifications });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleGetDelivery(
  deps: NotifyRouteDeps,
  request: Request,
  deliveryId: string,
): Promise<Response> {
  try {
    const entry = await deps.store.get(deliveryId);
    if (!entry) {
      return json({ error: 'not found' }, { status: 404 });
    }

    // Org-scoped entries require matching org context.
    if (entry.orgId) {
      const org = await ensureOrg(deps, request);
      if (!org.ok) {
        return json({ error: org.error }, { status: org.status });
      }
      if (org.orgId !== entry.orgId) {
        return json({ error: 'not found' }, { status: 404 });
      }
      const denied = await ensurePermission(
        deps,
        request,
        org,
        PERMISSION_EMAIL_READ,
      );
      if (denied) return denied;
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
    typeRaw === 'success' ||
    typeRaw === 'warning' ||
    typeRaw === 'error' ||
    typeRaw === 'info'
      ? typeRaw
      : 'info';
  const extensionId =
    typeof body?.extensionId === 'string' && body.extensionId.trim()
      ? body.extensionId.trim()
      : undefined;

  const templateId =
    typeof body?.templateId === 'string' ? body.templateId.trim() : undefined;
  const subject = typeof body?.subject === 'string' ? body.subject : undefined;
  const messageRaw =
    typeof body?.message === 'string' ? body.message : undefined;
  const vars = parseVars(body?.vars);
  const to = typeof body?.to === 'string' ? body.to.trim() : '';
  const bodyFrom =
    typeof body?.from === 'string' && body.from.trim()
      ? body.from.trim()
      : undefined;
  let orgId =
    typeof body?.orgId === 'string'
      ? body.orgId.trim()
      : (request.headers.get('x-agentos-org-id')?.trim() ?? undefined);
  let sessionUserId: string | undefined;

  // Session path: bind email/SMS sends to active org + email.send.
  if (channel === 'email' || channel === 'sms') {
    const org = await ensureOrg(deps, request);
    if (org.ok) {
      const denied = await ensurePermission(
        deps,
        request,
        org,
        PERMISSION_EMAIL_SEND,
      );
      if (denied) return denied;
      orgId = org.orgId;
      sessionUserId = org.userId;
    }
  }

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
      extensionId,
    });

    if (channel === 'in_app') {
      entry = await deps.store.markStatus(entry.id, 'sent');
      return json({ ok: true, notification: entry });
    }

    const { provider, source } = await resolveChannelProvider({
      channel,
      orgId: orgId || undefined,
      integrations: deps.integrations,
      platform: deps.providers,
      fetchImpl: deps.fetchImpl,
    });
    if (!provider) {
      entry = await deps.store.markStatus(entry.id, 'failed', {
        source,
        error: `no ${channel} provider configured`,
      });
      return json({ ok: true, notification: entry });
    }

    let fromOverride = bodyFrom;
    const prefsStore =
      channel === 'email'
        ? deps.userPrefs
        : channel === 'sms'
          ? deps.userSmsPrefs
          : undefined;
    if (!fromOverride && orgId && sessionUserId && prefsStore) {
      const pref = await prefsStore.get(orgId, sessionUserId).catch(() => null);
      if (pref?.from) fromOverride = pref.from;
    }

    const result = await provider.send({
      to,
      subject: rendered.value.subject,
      body: rendered.value.body,
      ...(fromOverride ? { from: fromOverride } : {}),
    });

    entry = await deps.store.markStatus(
      entry.id,
      result.ok ? 'sent' : 'failed',
      result.ok
        ? { provider: result.provider, source }
        : { provider: result.provider, source, error: result.error },
    );
    return json({ ok: true, notification: entry });
  } catch (error) {
    return unavailable(error);
  }
}

function isPlausibleFromAddress(value: string): boolean {
  // Accepts `user@domain.tld` or `Display Name <user@domain.tld>`.
  const trimmed = value.trim();
  const angleMatch = trimmed.match(/<([^<>]+)>$/);
  const email = (angleMatch ? angleMatch[1] : trimmed) ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function resolveOrgDefaultFrom(
  deps: NotifyRouteDeps,
  orgId: string,
): Promise<string | null> {
  if (deps.integrations) {
    try {
      const view = await deps.integrations.describeIntegration(
        orgId,
        EMAIL_SEND_INTEGRATION,
      );
      const from = view?.settings.from;
      if (typeof from === 'string' && from.trim()) return from.trim();
    } catch {
      // ignore — hint only
    }
  }
  const envFrom = (deps.runtimeEnv ?? Bun.env)
    .AGENT_OS_EXT_NOTIFICATIONS_EMAIL_FROM;
  return typeof envFrom === 'string' && envFrom.trim() ? envFrom.trim() : null;
}

export async function handleGetEmailPreference(
  deps: NotifyRouteDeps,
  request: Request,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  if (!org.userId) {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  try {
    const pref = deps.userPrefs
      ? await deps.userPrefs.get(org.orgId, org.userId)
      : null;
    const orgFrom = await resolveOrgDefaultFrom(deps, org.orgId);
    return json({
      from: pref?.from ?? null,
      orgFrom,
    });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleSetEmailPreference(
  deps: NotifyRouteDeps,
  request: Request,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  if (!org.userId) {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!deps.userPrefs) {
    return json(
      { error: 'user email preferences unavailable' },
      { status: 503 },
    );
  }
  const body = await readJsonBody(request);
  const rawFrom = body?.from;
  if (
    rawFrom !== null &&
    rawFrom !== undefined &&
    typeof rawFrom !== 'string'
  ) {
    return json({ error: 'from must be a string or null' }, { status: 400 });
  }
  const trimmed = typeof rawFrom === 'string' ? rawFrom.trim() : '';
  try {
    if (!trimmed) {
      await deps.userPrefs.clear(org.orgId, org.userId);
      const orgFrom = await resolveOrgDefaultFrom(deps, org.orgId);
      return json({ from: null, orgFrom });
    }
    if (!isPlausibleFromAddress(trimmed)) {
      return json(
        {
          error:
            'Enter a valid sender address (e.g. jane@acme.com or Jane <jane@acme.com>).',
        },
        { status: 400 },
      );
    }
    const saved = await deps.userPrefs.set(org.orgId, org.userId, trimmed);
    const orgFrom = await resolveOrgDefaultFrom(deps, org.orgId);
    return json({ from: saved.from, orgFrom });
  } catch (error) {
    return unavailable(error);
  }
}

async function resolveOrgDefaultSmsFrom(
  deps: NotifyRouteDeps,
  orgId: string,
): Promise<string | null> {
  if (deps.integrations) {
    try {
      const view = await deps.integrations.describeIntegration(
        orgId,
        SMS_INTEGRATION,
      );
      const from = view?.settings.from;
      if (typeof from === 'string' && from.trim()) return from.trim();
    } catch {
      // ignore — hint only
    }
  }
  const envFrom = (deps.runtimeEnv ?? Bun.env)
    .AGENT_OS_EXT_NOTIFICATIONS_SMS_FROM;
  return typeof envFrom === 'string' && envFrom.trim() ? envFrom.trim() : null;
}

export async function handleGetSmsPreference(
  deps: NotifyRouteDeps,
  request: Request,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  if (!org.userId) {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  try {
    const pref = deps.userSmsPrefs
      ? await deps.userSmsPrefs.get(org.orgId, org.userId)
      : null;
    const orgFrom = await resolveOrgDefaultSmsFrom(deps, org.orgId);
    return json({ from: pref?.from ?? null, orgFrom });
  } catch (error) {
    return unavailable(error);
  }
}

export async function handleSetSmsPreference(
  deps: NotifyRouteDeps,
  request: Request,
): Promise<Response> {
  const org = await ensureOrg(deps, request);
  if (!org.ok) {
    return json({ error: org.error }, { status: org.status });
  }
  if (!org.userId) {
    return json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!deps.userSmsPrefs) {
    return json({ error: 'user SMS preferences unavailable' }, { status: 503 });
  }
  const body = await readJsonBody(request);
  const rawFrom = body?.from;
  if (
    rawFrom !== null &&
    rawFrom !== undefined &&
    typeof rawFrom !== 'string'
  ) {
    return json({ error: 'from must be a string or null' }, { status: 400 });
  }
  const trimmed = typeof rawFrom === 'string' ? rawFrom.trim() : '';
  try {
    if (!trimmed) {
      await deps.userSmsPrefs.clear(org.orgId, org.userId);
      const orgFrom = await resolveOrgDefaultSmsFrom(deps, org.orgId);
      return json({ from: null, orgFrom });
    }
    if (!E164_PATTERN.test(trimmed)) {
      return json(
        { error: 'Pick a phone number in E.164 format (e.g. +15551234567).' },
        { status: 400 },
      );
    }
    const saved = await deps.userSmsPrefs.set(org.orgId, org.userId, trimmed);
    const orgFrom = await resolveOrgDefaultSmsFrom(deps, org.orgId);
    return json({ from: saved.from, orgFrom });
  } catch (error) {
    return unavailable(error);
  }
}

/**
 * SMS-capable numbers on the org's Twilio account (or the platform's), for
 * the sender dropdowns. Needs `email.send` — the permission to send at all.
 */
export async function handleListSmsNumbers(
  deps: NotifyRouteDeps,
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
  try {
    const { provider, source } = await resolveChannelProvider({
      channel: 'sms',
      orgId: org.orgId,
      integrations: deps.integrations,
      platform: deps.providers,
      fetchImpl: deps.fetchImpl,
    });
    if (!provider?.listSenders) {
      return json({ configured: false, source, numbers: [], error: null });
    }
    const result = await provider.listSenders();
    if (!result.ok) {
      return json({
        configured: true,
        source,
        numbers: [],
        error: result.error,
      });
    }
    return json({
      configured: true,
      source,
      numbers: result.numbers,
      error: null,
    });
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
  {
    method: 'GET',
    path: '/deliveries',
    handle: (d, r) => handleListDeliveries(d, r),
  },
  { method: 'POST', path: '/notify', handle: (d, r) => handleNotify(d, r) },
  {
    method: 'GET',
    path: '/preferences/email',
    handle: (d, r) => handleGetEmailPreference(d, r),
  },
  {
    method: 'PUT',
    path: '/preferences/email',
    handle: (d, r) => handleSetEmailPreference(d, r),
  },
  {
    method: 'GET',
    path: '/preferences/sms',
    handle: (d, r) => handleGetSmsPreference(d, r),
  },
  {
    method: 'PUT',
    path: '/preferences/sms',
    handle: (d, r) => handleSetSmsPreference(d, r),
  },
  {
    method: 'GET',
    path: '/sms/numbers',
    handle: (d, r) => handleListSmsNumbers(d, r),
  },
];
