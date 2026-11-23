const SECRET_KEY_RE =
  /^(password|passwd|secret|token|api[_-]?key|authorization|auth|master[_-]?key|private[_-]?key|access[_-]?key|refresh[_-]?token|client[_-]?secret)$/i;

/** Redact known secret-shaped keys before rendering meta in the Activity UI. */
export function redactMeta(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return redactUnknown(value) as Record<string, unknown>;
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = SECRET_KEY_RE.test(key) ? '[REDACTED]' : redactUnknown(child);
    }
    return out;
  }
  return value;
}
