/** Minimal chunk shape from Vite/Rollup `generateBundle` (avoids a direct `rollup` dep). */
export type EntryCssChunk = {
  fileName: string;
  imports: readonly string[];
  viteMetadata?: {
    importedCss?: Iterable<string>;
  };
};

export type EntryCssBundle = Record<
  string,
  { type: string } & Partial<EntryCssChunk>
>;

/**
 * Collect CSS filenames for an entry chunk, including CSS owned by imported
 * chunks (mirrors Vite's HTML plugin `getCssFilesForChunk`).
 *
 * Returns paths relative to the bundle root (e.g. `assets/globals-….css`),
 * suitable for `/`-prefixed `<link href>` tags.
 */
export function collectEntryCss(
  chunk: EntryCssChunk,
  bundle: EntryCssBundle,
  seenChunks: Set<string> = new Set(),
  seenCss: Set<string> = new Set(),
): string[] {
  if (seenChunks.has(chunk.fileName)) {
    return [];
  }
  seenChunks.add(chunk.fileName);

  const files: string[] = [];
  for (const file of chunk.imports) {
    const importee = bundle[file];
    if (importee?.type === 'chunk') {
      files.push(
        ...collectEntryCss(
          importee as EntryCssChunk,
          bundle,
          seenChunks,
          seenCss,
        ),
      );
    }
  }

  const importedCss = chunk.viteMetadata?.importedCss;
  if (importedCss) {
    for (const file of importedCss) {
      if (!seenCss.has(file)) {
        seenCss.add(file);
        files.push(file);
      }
    }
  }

  return files;
}
