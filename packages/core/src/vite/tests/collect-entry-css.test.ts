import { describe, expect, test } from 'bun:test';

import {
  collectEntryCss,
  type EntryCssBundle,
  type EntryCssChunk,
} from '@agentos/core/vite/lib/collect-entry-css';

function chunk(
  partial: Pick<EntryCssChunk, 'fileName' | 'imports'> & {
    importedCss?: string[];
  },
): EntryCssChunk {
  return {
    fileName: partial.fileName,
    imports: partial.imports,
    viteMetadata: {
      importedCss: new Set(partial.importedCss ?? []),
    },
  };
}

describe('collectEntryCss', () => {
  test('includes entry and transitive imported CSS in import order', () => {
    const shared = chunk({
      fileName: 'assets/shared.js',
      imports: [],
      importedCss: ['assets/shared.css'],
    });
    const entry = chunk({
      fileName: 'assets/widget.js',
      imports: ['assets/shared.js'],
      importedCss: ['assets/globals.css'],
    });
    const bundle: EntryCssBundle = {
      'assets/shared.js': { type: 'chunk', ...shared },
      'assets/widget.js': { type: 'chunk', ...entry },
    };

    expect(collectEntryCss(entry, bundle)).toEqual([
      'assets/shared.css',
      'assets/globals.css',
    ]);
  });

  test('dedupes CSS shared across chunks', () => {
    const a = chunk({
      fileName: 'assets/a.js',
      imports: [],
      importedCss: ['assets/globals.css'],
    });
    const entry = chunk({
      fileName: 'assets/entry.js',
      imports: ['assets/a.js'],
      importedCss: ['assets/globals.css', 'assets/page.css'],
    });
    const bundle: EntryCssBundle = {
      'assets/a.js': { type: 'chunk', ...a },
      'assets/entry.js': { type: 'chunk', ...entry },
    };

    expect(collectEntryCss(entry, bundle)).toEqual([
      'assets/globals.css',
      'assets/page.css',
    ]);
  });

  test('returns empty when no CSS metadata', () => {
    const entry = chunk({
      fileName: 'assets/bare.js',
      imports: [],
    });
    expect(
      collectEntryCss(entry, {
        'assets/bare.js': { type: 'chunk', ...entry },
      }),
    ).toEqual([]);
  });
});
