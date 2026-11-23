/**
 * Minimal cron helpers for the events scheduler.
 * Supports `@every <n>s|m|h` and standard 5-field cron (min hour dom month dow).
 */

const EVERY_RE = /^@every\s+(\d+)\s*(s|m|h)$/i;

export function parseEveryMs(expr: string): number | null {
  const match = EVERY_RE.exec(expr.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = match[2]!.toLowerCase();
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  return n * 3_600_000;
}

function fieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    const stepMatch = /^(\*|\d+|\d+-\d+)\/(\d+)$/.exec(part);
    if (stepMatch) {
      const step = Number(stepMatch[2]);
      if (!Number.isFinite(step) || step <= 0) return false;
      const range = stepMatch[1]!;
      let start = min;
      let end = max;
      if (range !== '*') {
        if (range.includes('-')) {
          const [a, b] = range.split('-').map(Number);
          start = a!;
          end = b!;
        } else {
          start = Number(range);
          end = max;
        }
      }
      if (value >= start && value <= end && (value - start) % step === 0) {
        return true;
      }
      continue;
    }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (value >= a! && value <= b!) return true;
      continue;
    }
    if (Number(part) === value) return true;
  }
  return false;
}

/** True when `date` matches a 5-field cron expression (minute-resolution). */
export function cronMatches(expr: string, date: Date): boolean {
  const every = parseEveryMs(expr);
  if (every !== null) {
    // `@every` is interval-based; matching is handled via nextRunAt, not wall clock.
    return false;
  }
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    fieldMatches(min!, date.getUTCMinutes(), 0, 59) &&
    fieldMatches(hour!, date.getUTCHours(), 0, 23) &&
    fieldMatches(dom!, date.getUTCDate(), 1, 31) &&
    fieldMatches(month!, date.getUTCMonth() + 1, 1, 12) &&
    fieldMatches(dow!, date.getUTCDay(), 0, 6)
  );
}

/** Compute next run after `from` for `@every` or 5-field cron. */
export function nextCronRun(expr: string, from: Date): Date {
  const every = parseEveryMs(expr);
  if (every !== null) {
    return new Date(from.getTime() + every);
  }
  // Scan forward up to 366 days at minute steps.
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(expr, cursor)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`cron expression never matches: ${expr}`);
}

export function initialNextRun(
  kind: 'at' | 'cron',
  opts: { runAt?: string; cron?: string },
  now: Date,
): Date {
  if (kind === 'at') {
    if (!opts.runAt) throw new Error('runAt required for kind "at"');
    const at = new Date(opts.runAt);
    if (Number.isNaN(at.getTime())) throw new Error('invalid runAt');
    return at;
  }
  if (!opts.cron) throw new Error('cron required for kind "cron"');
  const every = parseEveryMs(opts.cron);
  if (every !== null) return new Date(now.getTime() + every);
  // Fire on the next matching minute (or now if already matching wall clock).
  if (cronMatches(opts.cron, now)) return now;
  return nextCronRun(opts.cron, now);
}
