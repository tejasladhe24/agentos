import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Extension UIs reach other extensions only through host capabilities or a
 * `meta.json` `dependsOn` declaration (ticket 144). This guard fails if a
 * builtin UI hardcodes `/api/ext/<other>/…` without declaring it.
 */
const builtinsDir = join(import.meta.dir, '../../../builtins');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

function dependsOn(id: string): string[] {
  const metaPath = join(builtinsDir, id, 'meta.json');
  if (!existsSync(metaPath)) return [];
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    dependsOn?: string[];
  };
  return meta.dependsOn ?? [];
}

describe('builtin UI gateway paths', () => {
  test('only own-extension or declared dependsOn /api/ext/<id> literals', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const id of readdirSync(builtinsDir)) {
      const ui = join(builtinsDir, id, 'ui');
      if (!existsSync(ui)) continue;
      const allowed = new Set([id, ...dependsOn(id)]);
      for (const file of walk(ui)) {
        scanned += 1;
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/\/api\/ext\/([a-z0-9-]+)/g)) {
          if (!allowed.has(match[1]!)) {
            offenders.push(`${id}/ui/${file.split('/ui/')[1]} → ${match[0]}`);
          }
        }
      }
    }
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  test('inbound-email declares its notifications dependency', () => {
    expect(dependsOn('inbound-email')).toEqual(['notifications']);
  });
});
