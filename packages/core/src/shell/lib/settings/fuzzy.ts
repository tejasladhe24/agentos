/** A searchable text field with a relevance weight. */
export type FuzzyField = {
  text: string;
  /** Higher = more important (label > hint > description). */
  weight: number;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function words(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Levenshtein distance with an early-exit cap. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        row[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** Characters of `token` appear in order inside `word` (first char anchored). */
function isAnchoredSubsequence(token: string, word: string): boolean {
  if (token.length < 3 || token[0] !== word[0]) return false;
  let ti = 0;
  for (let wi = 0; wi < word.length && ti < token.length; wi++) {
    if (word[wi] === token[ti]) ti++;
  }
  return ti === token.length;
}

/**
 * Score one query token against one word:
 * exact 100 → prefix 80 → substring 55 → typo (edit distance) → subsequence.
 */
function scoreTokenAgainstWord(token: string, word: string): number {
  if (word === token) return 100;
  if (word.startsWith(token)) return 80;
  if (token.length >= 2 && word.includes(token)) return 55;
  if (token.length >= 4) {
    const max = token.length >= 7 ? 2 : 1;
    const distance = editDistance(token, word, max);
    if (distance <= max) return distance === 1 ? 45 : 30;
    // Typo in a longer word's prefix (e.g. "passwrd" vs "password").
    const prefix = word.slice(0, token.length);
    const prefixDistance = editDistance(token, prefix, max);
    if (prefixDistance <= max) return prefixDistance === 1 ? 40 : 25;
  }
  if (isAnchoredSubsequence(token, word)) return 20;
  return 0;
}

function scoreTokenAgainstField(token: string, field: FuzzyField): number {
  let best = 0;
  for (const word of words(field.text)) {
    const score = scoreTokenAgainstWord(token, word);
    if (score > best) best = score;
  }
  return best * field.weight;
}

/**
 * Fuzzy relevance of `query` against a set of weighted fields.
 *
 * Every query token must match at least one field (AND semantics); each token
 * contributes its best field score. Returns `0` when the query does not match.
 * Tolerates typos, partial words, and anchored abbreviations (`pwd` →
 * `password`).
 */
export function fuzzyScore(
  query: string,
  fields: readonly FuzzyField[],
): number {
  const tokens = words(query);
  if (tokens.length === 0) return 0;

  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of fields) {
      const score = scoreTokenAgainstField(token, field);
      if (score > best) best = score;
    }
    if (best === 0) return 0;
    total += best;
  }

  // Bonus when the whole query is a contiguous phrase in any field.
  const phrase = normalize(query).trim();
  if (
    phrase.includes(' ') &&
    fields.some((f) => normalize(f.text).includes(phrase))
  ) {
    total += 50;
  }

  return total / tokens.length;
}
