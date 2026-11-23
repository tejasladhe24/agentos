/** Exponential backoff in ms, capped at 1 hour. */
export function backoffMs(attempts: number): number {
  const base = 1_000;
  const ms = base * 2 ** Math.max(0, attempts - 1);
  return Math.min(ms, 60 * 60 * 1000);
}
