import {
  MICROSOFT_CLIENT_ID_ENV,
  MICROSOFT_CLIENT_SECRET_ENV,
  MICROSOFT_TENANT_ENV,
} from './constants';
import {
  createGraphClient,
  GRAPH_API,
  microsoftAuthority,
} from './microsoft-graph-client';
import { MountUnavailableError } from './mounts';
import { createOneDriveStore } from './onedrive-store';
import type { StorageProviderDefinition } from './storage-providers';

/**
 * `Files.ReadWrite.All` (not `Files.ReadWrite`) reaches SharePoint libraries;
 * `Sites.Read.All` lists followed sites. Neither needs admin consent by
 * default, but tenants may require it.
 */
export const ONEDRIVE_SCOPES = [
  'offline_access',
  'User.Read',
  'Files.ReadWrite.All',
  'Sites.Read.All',
];

export function microsoftOAuthClient(
  env: Record<string, string | undefined>,
): { clientId: string; clientSecret: string } | undefined {
  const clientId = env[MICROSOFT_CLIENT_ID_ENV]?.trim();
  const clientSecret = env[MICROSOFT_CLIENT_SECRET_ENV]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export type OneDriveProviderOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Entra tenant; defaults to the env value, then `common`. */
  tenant?: string;
};

export function createOneDriveProvider(
  options: OneDriveProviderOptions = {},
): StorageProviderDefinition {
  const fetchImpl = options.fetch ?? fetch;
  const tenant =
    options.tenant ?? Bun.env[MICROSOFT_TENANT_ENV]?.trim() ?? 'common';
  const { authorizeUrl, tokenUrl } = microsoftAuthority(tenant || 'common');
  return {
    id: 'onedrive',
    label: 'OneDrive',
    icon: 'Cloud',
    orgAddable: false,
    personal: true,
    oauth: {
      authorizeUrl,
      tokenUrl,
      scopes: ONEDRIVE_SCOPES,
      authorizeParams: { prompt: 'select_account', response_mode: 'query' },
      client: microsoftOAuthClient,
      async identify(accessToken) {
        const res = await fetchImpl(
          `${GRAPH_API}/me?$select=id,displayName,mail,userPrincipalName`,
          { headers: { authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) {
          throw new Error(`Microsoft account lookup failed (${res.status})`);
        }
        const body = (await res.json()) as {
          id?: string;
          displayName?: string;
          mail?: string | null;
          userPrincipalName?: string;
        };
        if (!body.id) throw new Error('Microsoft account lookup failed');
        const email = body.mail ?? body.userPrincipalName;
        return {
          accountId: body.id,
          ...(email ? { email } : {}),
          ...(body.displayName ? { name: body.displayName } : {}),
        };
      },
      // Microsoft has no per-app refresh token revocation; disconnect forgets
      // the tokens and users remove the app at myapps / account.live.com.
    },
    create(mount, ctx) {
      const client = microsoftOAuthClient(ctx.runtimeEnv ?? Bun.env);
      if (!client) {
        throw new MountUnavailableError(
          'OneDrive is not configured on this deployment',
        );
      }
      if (!ctx.credentials) {
        throw new MountUnavailableError('OneDrive credentials unavailable');
      }
      const email =
        typeof mount.config?.email === 'string'
          ? mount.config.email
          : undefined;
      return createOneDriveStore({
        graph: createGraphClient({
          credentials: ctx.credentials,
          client,
          tokenUrl,
          scopes: ONEDRIVE_SCOPES,
          fetch: fetchImpl,
          ...(options.sleep ? { sleep: options.sleep } : {}),
        }),
        ...(email ? { email } : {}),
      });
    },
  };
}
