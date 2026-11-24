import type { Icon } from '@phosphor-icons/react';

import type { ExtensionEntry } from '../chrome/extension-catalog';
import { resolveExtensionIcon } from '../chrome/resolve-extension-icon';
import type { UiContribution } from '../ui-contribs/contribution';
import { fuzzyScore } from './fuzzy';

/** One individual setting inside a section (searchable + deep-linkable). */
export type SettingsEntryItem = {
  id: string;
  label: string;
  /** Plain-text search hint. */
  hint?: string;
  keywords: string[];
};

export type SettingsNavItem = {
  /** Stable key: `${extensionId}:${sectionId}`. */
  key: string;
  extensionId: string;
  sectionId: string;
  label: string;
  description?: string;
  Icon: Icon;
  group: string;
  keywords: string[];
  /** Individual settings inside this section, used by Settings search. */
  entries: SettingsEntryItem[];
};

export type SettingsNavGroup = {
  group: string;
  items: SettingsNavItem[];
};

/** One Settings search hit: a whole section, or a single setting inside one. */
export type SettingsSearchResult = {
  /** Stable key for React lists. */
  key: string;
  item: SettingsNavItem;
  /** Present when the hit is a specific setting rather than the section. */
  entry?: SettingsEntryItem;
  score: number;
};

/**
 * Derive all Settings sidebar items strictly from enabled `view: 'settings'`
 * contributions. Extensions with `meta.settings` register one item per section;
 * extensions with `ui/settings.tsx` and no `meta.settings` automatically
 * register a single section using their name and icon.
 */
export function buildSettingsItems(input: {
  extensions: ExtensionEntry[];
  contributions: UiContribution[];
}): SettingsNavItem[] {
  const { extensions, contributions } = input;
  const extById = new Map(extensions.map((ext) => [ext.id, ext]));
  const items: SettingsNavItem[] = [];

  for (const contribution of contributions) {
    if (contribution.view !== 'settings') continue;
    const ext = extById.get(contribution.extensionId);
    if (!ext) continue;

    const defaultGroup = ext.kind === 'builtin' ? 'Platform' : 'Extensions';
    const declared = ext.settings;

    if (declared && declared.length > 0) {
      for (const section of declared) {
        items.push({
          key: `${ext.id}:${section.id}`,
          extensionId: ext.id,
          sectionId: section.id,
          label: section.label,
          ...(section.description ? { description: section.description } : {}),
          Icon: resolveExtensionIcon(section.icon ?? ext.icon),
          group: section.group ?? defaultGroup,
          keywords: [ext.id, ext.name, section.id, ...(section.keywords ?? [])],
          entries: (section.entries ?? []).map((entry) => ({
            id: entry.id,
            label: entry.label,
            ...(entry.hint ? { hint: entry.hint } : {}),
            keywords: entry.keywords ?? [],
          })),
        });
      }
      continue;
    }

    items.push({
      key: `${ext.id}:${ext.id}`,
      extensionId: ext.id,
      sectionId: ext.id,
      label: ext.name,
      Icon: resolveExtensionIcon(ext.icon),
      group: defaultGroup,
      keywords: [ext.id, ext.name],
      entries: [],
    });
  }

  return items;
}

/**
 * Fuzzy-search sections **and** the individual settings inside them.
 *
 * Section hits match on label / description / group / keywords; entry hits
 * match on label / plain-text hint / keywords (and inherit a small boost from
 * their parent section so "profile name" finds the Display name setting).
 * Results are ranked by relevance.
 */
export function searchSettings(
  items: readonly SettingsNavItem[],
  query: string,
  limit = 30,
): SettingsSearchResult[] {
  if (!query.trim()) return [];
  const results: SettingsSearchResult[] = [];

  for (const item of items) {
    const sectionScore = fuzzyScore(query, [
      { text: item.label, weight: 3 },
      { text: item.keywords.join(' '), weight: 2 },
      { text: item.group, weight: 1 },
      ...(item.description ? [{ text: item.description, weight: 1 }] : []),
    ]);
    if (sectionScore > 0) {
      results.push({ key: item.key, item, score: sectionScore });
    }

    for (const entry of item.entries) {
      const entryScore = fuzzyScore(query, [
        { text: entry.label, weight: 3 },
        { text: entry.keywords.join(' '), weight: 2 },
        ...(entry.hint ? [{ text: entry.hint, weight: 1.5 }] : []),
        // Parent context lets multi-word queries like "profile name" match.
        { text: item.label, weight: 0.75 },
        { text: item.keywords.join(' '), weight: 0.5 },
      ]);
      if (entryScore > 0) {
        results.push({
          key: `${item.key}#${entry.id}`,
          item,
          entry,
          score: entryScore,
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Sections that match a query (section-level or via any of their entries). */
export function filterSettingsItems(
  items: readonly SettingsNavItem[],
  query: string,
): SettingsNavItem[] {
  if (!query.trim()) return [...items];
  const matched = new Set(
    searchSettings(items, query, 1000).map((r) => r.item),
  );
  return items.filter((item) => matched.has(item));
}

/** Group settings items by `group` preserving first-seen order. */
export function groupSettingsItems(
  items: readonly SettingsNavItem[],
): SettingsNavGroup[] {
  const groups = new Map<string, SettingsNavItem[]>();
  for (const item of items) {
    let list = groups.get(item.group);
    if (!list) {
      list = [];
      groups.set(item.group, list);
    }
    list.push(item);
  }
  return [...groups.entries()].map(([group, groupItems]) => ({
    group,
    items: groupItems,
  }));
}
