import { GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV } from './constants';
import {
  createDriveClient,
  DRIVE_API,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
} from './google-drive-client';
import { createGoogleDriveStore } from './google-drive-store';
import { MountUnavailableError } from './mounts';
import type { StorageProviderDefinition } from './storage-providers';

/**
 * Full `drive` scope: users browse files AgentOS did not create. `drive.file`
 * would only expose files opened through a Google Picker.
 */
export const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];

export function googleOAuthClient(
  env: Record<string, string | undefined>,
): { clientId: string; clientSecret: string } | undefined {
  const clientId = env[GOOGLE_CLIENT_ID_ENV]?.trim();
  const clientSecret = env[GOOGLE_CLIENT_SECRET_ENV]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export type GoogleDriveProviderOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export function createGoogleDriveProvider(
  options: GoogleDriveProviderOptions = {},
): StorageProviderDefinition {
  const fetchImpl = options.fetch ?? fetch;
  return {
    id: 'google-drive',
    label: 'Google Drive',
    icon: 'GoogleDriveLogo',
    orgAddable: false,
    personal: true,
    oauth: {
      authorizeUrl: GOOGLE_AUTHORIZE_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      scopes: GOOGLE_DRIVE_SCOPES,
      // offline + consent: Google only returns a refresh token on consent.
      authorizeParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
      client: googleOAuthClient,
      async identify(accessToken) {
        const res = await fetchImpl(
          `${DRIVE_API}/about?fields=user(emailAddress,displayName,permissionId)`,
          { headers: { authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) {
          throw new Error(`Google Drive account lookup failed (${res.status})`);
        }
        const body = (await res.json()) as {
          user?: {
            emailAddress?: string;
            displayName?: string;
            permissionId?: string;
          };
        };
        const accountId = body.user?.permissionId ?? body.user?.emailAddress;
        if (!accountId) throw new Error('Google Drive account lookup failed');
        return {
          accountId,
          ...(body.user?.emailAddress ? { email: body.user.emailAddress } : {}),
          ...(body.user?.displayName ? { name: body.user.displayName } : {}),
        };
      },
      async revoke(tokens) {
        const token = tokens.refreshToken ?? tokens.accessToken;
        await fetchImpl(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }).toString(),
        });
      },
    },
    create(mount, ctx) {
      const client = googleOAuthClient(ctx.runtimeEnv ?? Bun.env);
      if (!client) {
        throw new MountUnavailableError(
          'Google Drive is not configured on this deployment',
        );
      }
      if (!ctx.credentials) {
        throw new MountUnavailableError('Google Drive credentials unavailable');
      }
      const email =
        typeof mount.config?.email === 'string'
          ? mount.config.email
          : undefined;
      return createGoogleDriveStore({
        drive: createDriveClient({
          credentials: ctx.credentials,
          client,
          fetch: fetchImpl,
          ...(options.sleep ? { sleep: options.sleep } : {}),
        }),
        ...(email ? { email } : {}),
      });
    },
  };
}
