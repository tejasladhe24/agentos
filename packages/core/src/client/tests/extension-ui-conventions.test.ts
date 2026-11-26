import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Consistency guards for extension UI (ticket 146). They cover the builtins
 * and every example extension, so new drift fails CI instead of an audit.
 */
const repoRoot = join(import.meta.dir, '../../../../../');
const builtinsDir = join(repoRoot, 'packages/core/builtins');
const examplesDir = join(repoRoot, 'examples');
const shellSrc = join(repoRoot, 'packages/core/src');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

/** `ui/` dirs of every builtin and every example extension. */
function uiDirs(): string[] {
  const dirs: string[] = [];
  for (const id of readdirSync(builtinsDir)) {
    dirs.push(join(builtinsDir, id, 'ui'));
  }
  for (const app of existsSync(examplesDir) ? readdirSync(examplesDir) : []) {
    const extRoot = join(examplesDir, app, 'extensions');
    if (!existsSync(extRoot)) continue;
    for (const id of readdirSync(extRoot)) dirs.push(join(extRoot, id, 'ui'));
  }
  return dirs.filter((dir) => existsSync(dir));
}

const rel = (path: string) => relative(repoRoot, path);

describe('extension UI conventions', () => {
  test('no native <button>/<input>/<select>/<textarea>/<table> without agentos-allow-native', () => {
    const offenders: string[] = [];
    for (const dir of uiDirs()) {
      for (const file of walk(dir)) {
        if (!file.endsWith('.tsx')) continue;
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!/<(button|input|select|textarea|table)\b/.test(line)) return;
          const nearby = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
          if (!nearby.includes('agentos-allow-native:')) {
            offenders.push(`${rel(file)}:${i + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  // Known oversized files still to be split (tracked in ticket 146 "As built").
  // Do not add to this list; split the file instead.
  const OVERSIZED_ALLOWLIST = new Set([
    'packages/core/builtins/auth/ui/components/account-members-section.tsx',
    'packages/core/builtins/auth/ui/components/account-roles-section.tsx',
    'packages/core/builtins/auth/ui/components/account-organization-section.tsx',
  ]);

  test('no ui/ source file exceeds 500 lines (except the tracked allowlist)', () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const dir of uiDirs()) {
      for (const file of walk(dir)) {
        const lines = readFileSync(file, 'utf8').split('\n').length;
        if (lines > 500) {
          seen.add(rel(file));
          if (!OVERSIZED_ALLOWLIST.has(rel(file))) {
            offenders.push(`${rel(file)} (${lines} lines)`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // The allowlist must shrink: drop entries once a file is under the limit.
    for (const allowed of OVERSIZED_ALLOWLIST) {
      expect(seen.has(allowed)).toBe(true);
    }
  });

  test('ui/ folders are not flat: more than 8 source files need components/ + lib/', () => {
    const offenders: string[] = [];
    for (const dir of uiDirs()) {
      const flat = readdirSync(dir).filter(
        (f) => /\.(ts|tsx)$/.test(f) && statSync(join(dir, f)).isFile(),
      );
      if (flat.length > 8) offenders.push(`${rel(dir)} (${flat.length} files)`);
    }
    expect(offenders).toEqual([]);
  });

  test('every settings page uses the shared SettingsPage frame', () => {
    const offenders: string[] = [];
    for (const dir of uiDirs()) {
      const file = join(dir, 'settings.tsx');
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (text.includes('fixed inset-0 overflow-y-auto')) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('fake crm / invoices fixtures stay out of production Shell code', () => {
    const offenders: string[] = [];
    for (const file of walk(shellSrc)) {
      if (file.includes('/tests/')) continue;
      if (
        /STUB_(EXTENSION_CATALOG|SKILLS_BY_EXTENSION)/.test(
          readFileSync(file, 'utf8'),
        )
      ) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
