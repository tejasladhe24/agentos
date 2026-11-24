/** Builtin vs customer extension (matches virtual:agentos-registry). */
export type ExtensionKind = 'builtin' | 'customer';

/** Activity Bar vertical region (from `meta.json`, coerced for customers). */
export type ActivityBarSection = 'primary' | 'secondary';

/** One individual setting inside a section (search + deep-link target). */
export type ExtensionSettingsEntry = {
  id: string;
  label: string;
  /** Plain-text search hint. */
  hint?: string;
  keywords?: string[];
};

/** One settings sidebar section registered by an extension's `meta.json`. */
export type ExtensionSettingsSection = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  group?: string;
  keywords?: string[];
  entries?: ExtensionSettingsEntry[];
};

/** One row in the Extension Manager list. */
export type ExtensionEntry = {
  id: string;
  name: string;
  kind: ExtensionKind;
  /** Builtins are never toggleable. */
  toggleable: boolean;
  /** Driving builtins (auth, db-store, …); all builtins are driven. */
  driven: boolean;
  /**
   * Phosphor icon basename from `meta.json` (`"Users"`, `"Receipt"`, …).
   * Shell resolves via `resolveExtensionIcon`; missing → Cube fallback.
   */
  icon?: string;
  /**
   * Activity Bar section. Defaults to `primary`. Only builtins may be `secondary`.
   */
  activityBarSection?: ActivityBarSection;
  /** Optional settings sidebar sections backed by `ui/settings.tsx`. */
  settings?: ExtensionSettingsSection[];
};

/** Builtins that own Activity Bar secondary chrome when meta omits a section. */
const DEFAULT_SECONDARY_BUILTIN_IDS = new Set(['auth', 'hitl']);

/**
 * Resolve Activity Bar section from meta + kind (+ id fallback).
 * Non-builtins are always `primary`. Builtins `auth` / `hitl` default to
 * `secondary` when `meta.activityBarSection` is omitted (stale registry safe).
 */
export function resolveActivityBarSection(
  metaSection: ActivityBarSection | undefined,
  kind: ExtensionKind,
  extensionId?: string,
): ActivityBarSection {
  if (kind !== 'builtin') {
    return 'primary';
  }
  if (metaSection === 'primary') {
    return 'primary';
  }
  if (metaSection === 'secondary') {
    return 'secondary';
  }
  if (extensionId && DEFAULT_SECONDARY_BUILTIN_IDS.has(extensionId)) {
    return 'secondary';
  }
  return 'primary';
}

/**
 * Manager-facing lifecycle status for an extension.
 * Frame-level status stays `loading | active | crashed`; `disabled` is extension-level.
 */
export type ExtensionManagerStatus =
  'active' | 'disabled' | 'crashed' | 'loading';

/**
 * Test fixture catalog (not used as Shell default — registry owns that).
 * Builtins match `.project/docs/builtins.md` driving set.
 */
export const STUB_EXTENSION_CATALOG: ExtensionEntry[] = [
  {
    id: 'auth',
    name: 'Auth',
    kind: 'builtin',
    toggleable: false,
    driven: true,
    activityBarSection: 'secondary',
  },
  {
    id: 'db-store',
    name: 'DB Store',
    kind: 'builtin',
    toggleable: false,
    driven: true,
  },
  {
    id: 'cache-store',
    name: 'Cache Store',
    kind: 'builtin',
    toggleable: false,
    driven: true,
  },
  { id: 'ai', name: 'AI', kind: 'builtin', toggleable: false, driven: true },
  {
    id: 'crm',
    name: 'CRM',
    kind: 'customer',
    toggleable: true,
    driven: false,
  },
  {
    id: 'invoices',
    name: 'Invoices',
    kind: 'customer',
    toggleable: true,
    driven: false,
  },
];

/** Default enable map: every catalog entry starts enabled. */
export function defaultEnabledById(
  extensions: ExtensionEntry[] = STUB_EXTENSION_CATALOG,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const ext of extensions) {
    out[ext.id] = true;
  }
  return out;
}

/**
 * Test fixture skills (Shell defaults come from `applyRegistry`).
 * Keys are extension ids from {@link STUB_EXTENSION_CATALOG}.
 */
export const STUB_SKILLS_BY_EXTENSION: Record<string, string[]> = {
  crm: ['search-contacts', 'create-contact'],
  invoices: ['list-invoices', 'create-invoice'],
};

/** Skills for currently enabled extensions (from stub map). */
export function defaultSkillsByExtension(
  enabledById: Record<string, boolean> = defaultEnabledById(),
  stubs: Record<string, string[]> = STUB_SKILLS_BY_EXTENSION,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [extensionId, skills] of Object.entries(stubs)) {
    if (enabledById[extensionId] !== false) {
      out[extensionId] = [...skills];
    }
  }
  return out;
}

export type PaletteSkill = {
  extensionId: string;
  extensionName: string;
  skill: string;
};

/** Flatten enabled-extension skills for the command palette. */
export function collectEnabledSkills(
  skillsByExtension: Record<string, string[]>,
  enabledById: Record<string, boolean>,
  extensions: ExtensionEntry[] = STUB_EXTENSION_CATALOG,
): PaletteSkill[] {
  const nameById = new Map(extensions.map((e) => [e.id, e.name]));
  const items: PaletteSkill[] = [];
  for (const [extensionId, skills] of Object.entries(skillsByExtension)) {
    if (enabledById[extensionId] === false) continue;
    const extensionName = nameById.get(extensionId) ?? extensionId;
    for (const skill of skills) {
      items.push({ extensionId, extensionName, skill });
    }
  }
  return items;
}
