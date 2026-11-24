import { BlobStoreError } from './blob-store-error';
import type {
  StorageProviderField,
  StorageProviderPreset,
} from './storage-providers';

export type S3PresetId =
  'aws' | 'r2' | 'gcs' | 'b2' | 'wasabi' | 'do-spaces' | 'minio' | 'supabase';

type S3PresetDefinition = StorageProviderPreset & {
  id: S3PresetId;
  /** Bucket in the host name (`bucket.endpoint`) instead of the path. */
  virtualHostedStyle: boolean;
  defaultRegion?: string;
  endpoint?: (values: S3LocationInput) => string | undefined;
};

export type S3LocationInput = {
  endpoint?: string;
  region?: string;
  accountId?: string;
  projectRef?: string;
};

export type ResolvedS3Location = {
  /** Undefined → Bun's AWS default for the region. */
  endpoint?: string;
  region: string;
  virtualHostedStyle: boolean;
};

export const S3_PRESETS: readonly S3PresetDefinition[] = [
  {
    id: 'aws',
    label: 'AWS S3',
    help: 'Region is required (e.g. us-east-1). Endpoint is optional — leave empty for AWS.',
    required: ['bucket', 'region'],
    fields: ['bucket', 'region', 'endpoint', 'prefix'],
    virtualHostedStyle: true,
    endpoint: (v) => v.endpoint,
  },
  {
    id: 'r2',
    label: 'Cloudflare R2',
    help: 'Use an R2 API token (Access Key ID + Secret). Endpoint is https://<accountId>.r2.cloudflarestorage.com.',
    required: ['bucket', 'accountId'],
    fields: ['bucket', 'accountId', 'prefix'],
    virtualHostedStyle: false,
    defaultRegion: 'auto',
    endpoint: (v) =>
      v.accountId
        ? `https://${v.accountId}.r2.cloudflarestorage.com`
        : undefined,
  },
  {
    id: 'gcs',
    label: 'Google Cloud Storage',
    help: 'Create HMAC keys under Cloud Storage › Settings › Interoperability.',
    required: ['bucket'],
    fields: ['bucket', 'prefix'],
    virtualHostedStyle: false,
    defaultRegion: 'auto',
    endpoint: () => 'https://storage.googleapis.com',
  },
  {
    id: 'b2',
    label: 'Backblaze B2',
    help: 'Region is the part of your bucket endpoint after "s3." (e.g. us-west-004). Use an application key.',
    required: ['bucket', 'region'],
    fields: ['bucket', 'region', 'prefix'],
    virtualHostedStyle: false,
    endpoint: (v) =>
      v.region ? `https://s3.${v.region}.backblazeb2.com` : undefined,
  },
  {
    id: 'wasabi',
    label: 'Wasabi',
    help: 'Region of the bucket (e.g. us-east-1, eu-central-1).',
    required: ['bucket', 'region'],
    fields: ['bucket', 'region', 'prefix'],
    virtualHostedStyle: false,
    defaultRegion: 'us-east-1',
    endpoint: (v) =>
      v.region ? `https://s3.${v.region}.wasabisys.com` : undefined,
  },
  {
    id: 'do-spaces',
    label: 'DigitalOcean Spaces',
    help: 'Region is the Spaces datacenter (e.g. nyc3, fra1). Use a Spaces access key.',
    required: ['bucket', 'region'],
    fields: ['bucket', 'region', 'prefix'],
    virtualHostedStyle: true,
    endpoint: (v) =>
      v.region ? `https://${v.region}.digitaloceanspaces.com` : undefined,
  },
  {
    id: 'minio',
    label: 'MinIO / custom',
    help: 'Any S3-compatible endpoint. Uses path-style requests.',
    required: ['bucket', 'endpoint'],
    fields: ['bucket', 'endpoint', 'region', 'prefix'],
    virtualHostedStyle: false,
    defaultRegion: 'us-east-1',
    endpoint: (v) => v.endpoint,
  },
  {
    id: 'supabase',
    label: 'Supabase Storage',
    help: 'Project Settings › Storage › S3 Connection: copy the region and create access keys. Endpoint is https://<projectRef>.supabase.co/storage/v1/s3.',
    required: ['bucket', 'region', 'projectRef'],
    fields: ['bucket', 'projectRef', 'region', 'prefix'],
    virtualHostedStyle: false,
    endpoint: (v) =>
      v.projectRef
        ? `https://${v.projectRef}.supabase.co/storage/v1/s3`
        : v.endpoint,
  },
];

export const S3_FIELDS: readonly StorageProviderField[] = [
  { id: 'bucket', label: 'Bucket', type: 'text', placeholder: 'my-bucket' },
  { id: 'region', label: 'Region', type: 'text', placeholder: 'us-east-1' },
  {
    id: 'endpoint',
    label: 'Endpoint',
    type: 'text',
    placeholder: 'https://s3.example.com',
  },
  {
    id: 'accountId',
    label: 'Account ID',
    type: 'text',
    placeholder: 'Cloudflare account ID',
  },
  {
    id: 'projectRef',
    label: 'Project ref',
    type: 'text',
    placeholder: 'abcdefghijklmnopqrst',
  },
  {
    id: 'prefix',
    label: 'Folder prefix',
    type: 'text',
    placeholder: 'optional/sub/path',
    help: 'Mount only this path inside the bucket.',
  },
  { id: 'accessKeyId', label: 'Access key ID', type: 'secret' },
  { id: 'secretAccessKey', label: 'Secret access key', type: 'secret' },
  {
    id: 'sessionToken',
    label: 'Session token',
    type: 'secret',
    help: 'Only for temporary credentials.',
  },
];

export const S3_SECRET_FIELDS = [
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
] as const;

export const S3_LOCATION_FIELDS = [
  'preset',
  'bucket',
  'endpoint',
  'region',
  'accountId',
  'projectRef',
  'prefix',
];

const BUCKET_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,221}[a-zA-Z0-9]$/;
const REGION_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ACCOUNT_PATTERN = /^[a-zA-Z0-9]{8,64}$/;
const PROJECT_REF_PATTERN = /^[a-z0-9]{8,40}$/;

export function getS3Preset(id: unknown): S3PresetDefinition | undefined {
  return S3_PRESETS.find((p) => p.id === id);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function invalid(message: string): BlobStoreError {
  return new BlobStoreError(message, 400);
}

function checkEndpoint(raw: string, allowHttp: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid(`endpoint must be a URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw invalid(
      allowHttp
        ? 'endpoint must use http(s)'
        : 'endpoint must use https (http is allowed for MinIO / custom only)',
    );
  }
  if (url.search || url.hash || url.username || url.password) {
    throw invalid('endpoint must not include credentials, query, or hash');
  }
  return url.toString().replace(/\/+$/, '');
}

/** Validate preset settings and resolve the endpoint / region / URL style. */
export function resolveS3Location(
  config: Record<string, unknown>,
): ResolvedS3Location & { bucket: string; preset: S3PresetId } {
  const preset = getS3Preset(config.preset ?? 'aws');
  if (!preset) throw invalid(`unknown S3 preset: ${String(config.preset)}`);
  const values: S3LocationInput & { bucket?: string } = {
    bucket: str(config.bucket),
    endpoint: str(config.endpoint),
    region: str(config.region) ?? preset.defaultRegion,
    accountId: str(config.accountId),
    projectRef: str(config.projectRef),
  };
  for (const field of preset.required ?? []) {
    if (!values[field as keyof typeof values]) {
      if (preset.id === 'supabase' && field === 'projectRef' && values.endpoint)
        continue;
      throw invalid(`${preset.label}: ${field} is required`);
    }
  }
  if (!values.bucket || !BUCKET_PATTERN.test(values.bucket)) {
    throw invalid('bucket name is invalid');
  }
  if (values.region && !REGION_PATTERN.test(values.region)) {
    throw invalid('region is invalid');
  }
  if (values.accountId && !ACCOUNT_PATTERN.test(values.accountId)) {
    throw invalid('account ID is invalid');
  }
  if (values.projectRef && !PROJECT_REF_PATTERN.test(values.projectRef)) {
    throw invalid('project ref is invalid');
  }
  const rawEndpoint = preset.endpoint?.(values);
  const endpoint = rawEndpoint
    ? checkEndpoint(rawEndpoint, preset.id === 'minio')
    : undefined;
  return {
    preset: preset.id,
    bucket: values.bucket,
    endpoint,
    region: values.region ?? 'us-east-1',
    virtualHostedStyle: preset.virtualHostedStyle,
  };
}

/** Endpoint used for raw signed calls (CopyObject) — always path-style. */
export function pathStyleEndpoint(location: ResolvedS3Location): string {
  return location.endpoint ?? `https://s3.${location.region}.amazonaws.com`;
}
