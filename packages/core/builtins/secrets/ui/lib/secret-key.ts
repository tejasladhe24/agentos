/** Mirrors API `SECRET_KEY_PATTERN` for client-side create validation. */
export const SECRET_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._/-]{0,127}$/;

export function validateSecretKeyClient(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return 'Key name is required';
  if (!SECRET_KEY_PATTERN.test(trimmed)) {
    return 'Use a letter start; letters, digits, . _ - /; max 128 characters';
  }
  return null;
}
