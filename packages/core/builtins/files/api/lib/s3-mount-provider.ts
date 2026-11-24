import { BlobStoreError } from './blob-store-error';
import { normalizeBlobKey } from './normalize-key';
import { createS3BlobStore, type S3ClientLike } from './s3-blob-store';
import {
  pathStyleEndpoint,
  resolveS3Location,
  S3_FIELDS,
  S3_LOCATION_FIELDS,
  S3_PRESETS,
  S3_SECRET_FIELDS,
} from './s3-presets';
import type { StorageProviderDefinition } from './storage-providers';

export type S3MountClientInput = {
  bucket: string;
  endpoint?: string;
  region: string;
  virtualHostedStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type S3MountProviderOptions = {
  /** Test injection — build a fake client per mount. */
  createClient?: (input: S3MountClientInput) => S3ClientLike;
  /** Test injection — fetch used for server-side CopyObject. */
  fetch?: typeof fetch;
};

function mountPrefix(config: Record<string, unknown>): string {
  const raw = config.prefix;
  if (typeof raw !== 'string' || !raw.replace(/\/+/g, '').trim()) return '';
  return `${normalizeBlobKey(raw)}/`;
}

/** Org-addable bucket mounts (`files.mount` / `s3`) with BYOK presets. */
export function createS3MountProvider(
  options: S3MountProviderOptions = {},
): StorageProviderDefinition {
  return {
    id: 's3',
    label: 'S3-compatible bucket',
    icon: 'Cloud',
    orgAddable: true,
    locationFields: S3_LOCATION_FIELDS,
    secretFields: [...S3_SECRET_FIELDS],
    fields: S3_FIELDS,
    presets: S3_PRESETS.map(({ id, label, help, fields, required }) => ({
      id,
      label,
      help,
      fields,
      required,
    })),
    create(mount, ctx) {
      const config = mount.config ?? {};
      const location = resolveS3Location(config);
      const accessKeyId = ctx.secrets.accessKeyId?.trim();
      const secretAccessKey = ctx.secrets.secretAccessKey?.trim();
      if (!accessKeyId || !secretAccessKey) {
        throw new BlobStoreError(
          'access key ID and secret access key are required',
          400,
        );
      }
      const input: S3MountClientInput = {
        bucket: location.bucket,
        endpoint: location.endpoint,
        region: location.region,
        virtualHostedStyle: location.virtualHostedStyle,
        accessKeyId,
        secretAccessKey,
        sessionToken: ctx.secrets.sessionToken?.trim() || undefined,
      };
      return createS3BlobStore({
        ...input,
        label: `s3://${location.bucket}`,
        probePrefix: mountPrefix(config),
        serverCopy: {
          endpoint: pathStyleEndpoint(location),
          region: location.region,
          fetch: options.fetch,
        },
        client: options.createClient?.(input),
      });
    },
  };
}
