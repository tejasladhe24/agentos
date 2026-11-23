export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function unavailable(error: unknown): Response {
  const detail = error instanceof Error ? error.message : String(error);
  return json({ error: 'unavailable', detail }, { status: 503 });
}

/** Normalize email addresses for lookup (strip display name, lowercase). */
export function normalizeAddress(raw: string): string {
  const trimmed = raw.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  const email = (angle?.[1] ?? trimmed).trim().toLowerCase();
  return email;
}

export function parseAddressMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) return map;
  for (const part of raw.split(',')) {
    const piece = part.trim();
    if (!piece) continue;
    const eq = piece.indexOf('=');
    const colon = piece.indexOf(':');
    const sep =
      eq >= 0 && (colon < 0 || eq < colon) ? eq : colon >= 0 ? colon : -1;
    if (sep < 0) continue;
    const address = normalizeAddress(piece.slice(0, sep));
    const orgId = piece.slice(sep + 1).trim();
    if (address && orgId) map.set(address, orgId);
  }
  return map;
}
