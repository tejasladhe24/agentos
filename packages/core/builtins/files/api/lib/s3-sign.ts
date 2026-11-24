/**
 * Minimal AWS Signature V4 for the one S3 call Bun.S3Client lacks
 * (CopyObject). Path-style URLs only — every supported preset accepts them.
 */

export type S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type SignS3RequestInput = {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  region: string;
  credentials: S3Credentials;
  now?: Date;
  /** Hex SHA-256 of the body, or `UNSIGNED-PAYLOAD`. */
  payloadHash?: string;
  service?: string;
};

export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function hmac(key: string | Uint8Array, data: string): Uint8Array {
  const hasher = new Bun.CryptoHasher('sha256', key);
  hasher.update(data);
  return new Uint8Array(hasher.digest());
}

function sha256Hex(data: string): string {
  return new Bun.CryptoHasher('sha256').update(data).digest('hex');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** RFC 3986 encoding (S3 canonical form). */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key for a URL path, keeping `/` separators. */
export function encodeS3Key(key: string): string {
  return key.split('/').map(rfc3986).join('/');
}

function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { stamp, day: stamp.slice(0, 8) };
}

/** Returns the request headers plus `authorization` (lowercase names). */
export function signS3Request(
  input: SignS3RequestInput,
): Record<string, string> {
  const service = input.service ?? 's3';
  const { stamp, day } = amzDate(input.now ?? new Date());
  const payloadHash = input.payloadHash ?? 'UNSIGNED-PAYLOAD';
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  }
  headers.host = input.url.host;
  headers['x-amz-content-sha256'] = payloadHash;
  headers['x-amz-date'] = stamp;
  if (input.credentials.sessionToken) {
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  }

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) =>
      a === b ? av.localeCompare(bv) : a < b ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.url.pathname || '/',
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = toHex(hmac(kSigning, stringToSign));

  delete headers.host;
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

/** S3 error from a raw HTTP call (Bun.S3Client throws its own `S3Error`). */
export class S3RequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'S3RequestError';
    this.code = code;
    this.status = status;
  }
}

function xmlTag(body: string, tag: string): string | undefined {
  return body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
}

export type CopyObjectInput = {
  endpoint: string;
  bucket: string;
  region: string;
  credentials: S3Credentials;
  fromKey: string;
  toKey: string;
  fetch?: typeof fetch;
  now?: Date;
};

/** Server-side `CopyObject` within one bucket. */
export async function s3CopyObject(input: CopyObjectInput): Promise<void> {
  const base = input.endpoint.replace(/\/+$/, '');
  const bucket = rfc3986(input.bucket);
  const url = new URL(`${base}/${bucket}/${encodeS3Key(input.toKey)}`);
  const headers = signS3Request({
    method: 'PUT',
    url,
    region: input.region,
    credentials: input.credentials,
    now: input.now,
    payloadHash: EMPTY_PAYLOAD_SHA256,
    headers: {
      'x-amz-copy-source': `/${bucket}/${encodeS3Key(input.fromKey)}`,
    },
  });
  const res = await (input.fetch ?? fetch)(url, { method: 'PUT', headers });
  const body = await res.text();
  // CopyObject can fail with a 200 status and an <Error> body.
  if (!res.ok || body.includes('<Error>')) {
    throw new S3RequestError(
      xmlTag(body, 'Code') ?? `HTTP${res.status}`,
      xmlTag(body, 'Message') ?? `copy failed (${res.status})`,
      res.ok ? 500 : res.status,
    );
  }
}
