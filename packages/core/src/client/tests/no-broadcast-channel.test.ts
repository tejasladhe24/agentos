import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Extension UIs must share state through the Shell event bus
 * (`useHostEvent` / `useHostSharedState`), never a raw `BroadcastChannel`
 * (ticket 143). The Shell itself and the SDK are not extension UI.
 */
const repoRoot = join(import.meta.dir, '../../../../..');
const builtinsDir = join(repoRoot, 'packages/core/builtins');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

function uiFiles(): string[] {
  const files: string[] = [];
  for (const builtin of readdirSync(builtinsDir)) {
    const ui = join(builtinsDir, builtin, 'ui');
    if (existsSync(ui)) walk(ui, files);
  }
  for (const root of ['extensions', 'examples']) {
    const dir = join(repoRoot, root);
    if (!existsSync(dir)) continue;
    for (const ext of readdirSync(dir)) {
      const ui = join(dir, ext, 'ui');
      if (existsSync(ui)) walk(ui, files);
    }
  }
  return files;
}

describe('extension UI event hygiene', () => {
  test('scans a non-trivial set of UI files', () => {
    expect(uiFiles().length).toBeGreaterThan(20);
  });

  test('no extension UI references BroadcastChannel', () => {
    const offenders = uiFiles().filter((file) =>
      /BroadcastChannel/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((f) => f.replace(`${repoRoot}/`, ''))).toEqual([]);
  });
});
