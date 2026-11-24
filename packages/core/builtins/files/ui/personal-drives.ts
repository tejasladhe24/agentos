import type { HostAPIClient } from '@agentos/core/client';

import { parseErrorBody } from './files-types';

/** Query flag the files API appends after the OAuth callback. */
export const DRIVE_RESULT_PARAM = 'files_drive';

export type DriveConnectResult = {
  status: 'connected' | 'error';
  message?: string;
};

/**
 * Start (or restart) a personal drive OAuth flow. The consent page replaces
 * the Shell tab; the callback returns to `/`, where the Shell restores the
 * last view. Resolves to an error message, or `null` once navigating.
 */
export async function startDriveConnect(
  api: HostAPIClient['api'],
  navigation: HostAPIClient['navigation'],
  providerId: string,
  mountId?: string,
): Promise<string | null> {
  const res = await api.fetch(
    `/personal-mounts/${encodeURIComponent(providerId)}/connect`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: '/', ...(mountId ? { mountId } : {}) }),
    },
  );
  if (!res.ok) return parseErrorBody(res.body, 'Could not start connecting');
  try {
    const { url } = JSON.parse(res.body) as { url?: string };
    if (!url) return 'Could not start connecting';
    await navigation.openExternal(url, { sameTab: true });
    return null;
  } catch {
    return 'Could not start connecting';
  }
}

/** Connect outcome from the Shell URL (same-origin parent), shown once. */
export function readDriveConnectResult(): DriveConnectResult | null {
  try {
    const search = window.top?.location.search ?? '';
    const params = new URLSearchParams(search);
    const status = params.get(DRIVE_RESULT_PARAM);
    if (status !== 'connected' && status !== 'error') return null;
    const seenKey = `files:drive-result:${search}`;
    if (window.sessionStorage.getItem(seenKey)) return null;
    window.sessionStorage.setItem(seenKey, '1');
    const message = params.get(`${DRIVE_RESULT_PARAM}_message`);
    return message ? { status, message } : { status };
  } catch {
    return null;
  }
}
