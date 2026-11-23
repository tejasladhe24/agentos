import { SECRET_KEY_PATTERN } from './constants';

/** Return null when `key` is valid; otherwise an error message. */
export function validateSecretKey(key: string): string | null {
  if (!key || typeof key !== 'string') {
    return 'key required';
  }
  if (!SECRET_KEY_PATTERN.test(key)) {
    return 'invalid key (use letter start; letters, digits, . _ - /; max 128)';
  }
  return null;
}
