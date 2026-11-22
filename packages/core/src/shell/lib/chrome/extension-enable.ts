/**
 * Client calls to the gateway enable/disable API
 * (`POST /api/extensions/:id/enable`, `GET /api/extensions/enable-state`).
 */

/** POST enable/disable for a customer extension. */
export async function requestExtensionEnable(
  extensionId: string,
  enabled: boolean,
): Promise<void> {
  try {
    await fetch(`/api/extensions/${encodeURIComponent(extensionId)}/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  } catch {
    // Gateway not available (e.g. unit tests) — UI state already updated locally.
  }
}

/** Fetch durable enable overrides from the gateway (ticket 60). */
export async function requestExtensionEnableState(): Promise<Record<
  string,
  boolean
> | null> {
  try {
    const res = await fetch('/api/extensions/enable-state');
    if (!res.ok) return null;
    const body = (await res.json()) as { enabledById?: unknown };
    if (
      typeof body.enabledById !== 'object' ||
      body.enabledById === null ||
      Array.isArray(body.enabledById)
    ) {
      return null;
    }
    const out: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(body.enabledById)) {
      if (typeof value === 'boolean') {
        out[id] = value;
      }
    }
    return out;
  } catch {
    return null;
  }
}
