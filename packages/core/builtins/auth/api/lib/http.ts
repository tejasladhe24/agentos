import { isAPIError } from 'better-auth/api';

/** JSON response with charset content-type. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function mergeSetCookie(from: Headers, into: Headers): void {
  const cookies =
    typeof from.getSetCookie === 'function'
      ? from.getSetCookie()
      : from.get('set-cookie')
        ? [from.get('set-cookie')!]
        : [];
  for (const cookie of cookies) {
    into.append('set-cookie', cookie);
  }
}

/** Cookie header value from a Better Auth `asResponse` result. */
export function cookieHeaderFrom(response: Response): string {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

export async function readJsonBody(
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

/** Map Better Auth APIError → JSON response; rethrow anything else. */
export function apiErrorResponse(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus: number,
): Response {
  if (isAPIError(error)) {
    return json(
      { error: error.message ?? fallbackMessage },
      {
        status:
          typeof error.status === 'number' ? error.status : fallbackStatus,
      },
    );
  }
  throw error;
}

/** Forward Set-Cookie and return text/JSON error body when `response` is not ok. */
export async function forwardAuthFailure(
  response: Response,
  fallbackMessage: string,
): Promise<Response> {
  const outHeaders = new Headers();
  mergeSetCookie(response.headers, outHeaders);
  const errBody = await response.text();
  return new Response(errBody || JSON.stringify({ error: fallbackMessage }), {
    status: response.status,
    headers: outHeaders,
  });
}
