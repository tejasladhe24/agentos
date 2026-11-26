import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';

const root = mkdtempSync(join(tmpdir(), 'agentos-right-sheet-'));
const extensionsDir = join(root, 'extensions');
const builtinsDir = join(root, 'builtins');
mkdirSync(builtinsDir, { recursive: true });

function writeFile(path: string, contents: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

// Extension with a right sheet + rightSheet meta block.
const notesRoot = join(extensionsDir, 'notes');
writeFile(join(notesRoot, 'ui/right-sheet.tsx'), 'export default null;');
writeFile(
  join(notesRoot, 'meta.json'),
  JSON.stringify({
    name: 'Notes',
    rightSheet: { label: 'Inbox', description: 'Recent notes', icon: 'Bell' },
  }),
);

// Extension with a right sheet file but a malformed rightSheet block.
const bareRoot = join(extensionsDir, 'bare');
writeFile(join(bareRoot, 'ui/right-sheet.ts'), 'export default null;');
writeFile(
  join(bareRoot, 'meta.json'),
  JSON.stringify({ name: 'Bare', rightSheet: 'not-an-object' }),
);

// Extension without any right sheet.
const plainRoot = join(extensionsDir, 'plain');
writeFile(join(plainRoot, 'ui/page.tsx'), 'export default null;');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanExtensions ui/right-sheet', () => {
  test('discovers ui/right-sheet.{tsx,ts} and emits its iframe entry URL', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const notes = model.extensions.find((e) => e.id === 'notes');
    const bare = model.extensions.find((e) => e.id === 'bare');
    const plain = model.extensions.find((e) => e.id === 'plain');

    expect(notes?.ui['right-sheet']).toBe(
      join(notesRoot, 'ui/right-sheet.tsx'),
    );
    expect(notes?.uiEntries['right-sheet']).toBe(
      '/__agentos/ext/notes/right-sheet.html',
    );
    expect(bare?.ui['right-sheet']).toBe(join(bareRoot, 'ui/right-sheet.ts'));
    expect(plain?.ui['right-sheet']).toBeUndefined();
    expect(plain?.uiEntries['right-sheet']).toBeUndefined();
  });

  test('parses meta.json rightSheet label, description, and icon', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const notes = model.extensions.find((e) => e.id === 'notes');

    expect(notes?.meta.rightSheet).toEqual({
      label: 'Inbox',
      description: 'Recent notes',
      icon: 'Bell',
    });
  });

  test('ignores a malformed rightSheet block without dropping the file', () => {
    const model = scanExtensions({ extensionsDir, builtinsDir });
    const bare = model.extensions.find((e) => e.id === 'bare');

    expect(bare?.meta.rightSheet).toBeUndefined();
    expect(bare?.uiEntries['right-sheet']).toBe(
      '/__agentos/ext/bare/right-sheet.html',
    );
  });
});
