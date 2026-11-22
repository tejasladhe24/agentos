/** JSON response helper for gateway handlers. */
export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Plain-text response helper for gateway handlers. */
export function plainResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Method-not-allowed response with Allow header. */
export function methodNotAllowedResponse(allow: string): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: allow,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

/** Pathname of a Request URL (no query). */
export function requestPathname(request: Request): string {
  return new URL(request.url).pathname;
}

/** Search string including leading `?`, or empty. */
export function requestSearch(request: Request): string {
  return new URL(request.url).search;
}
