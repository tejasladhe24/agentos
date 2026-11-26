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
  /** Hidden from Settings search for non-admins. */
  adminOnly?: boolean;
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
  /** Whole section hidden from the Settings sidebar for non-admins. */
  adminOnly?: boolean;
};

/** Event-bus topics an extension declared in `meta.json` `events`. */
export type ExtensionEventDeclarations = {
  publishes?: string[];
  subscribes?: string[];
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
  /** Optional global right sheet labels/icon (`meta.json` `rightSheet`). */
  rightSheet?: ExtensionRightSheetMeta;
  /** Event-bus topics this extension's UI may publish / subscribe to. */
  events?: ExtensionEventDeclarations;
  /**
   * Other extensions this one's UI may call by absolute `/api/ext/<id>/…`
   * path (`meta.json` `dependsOn`). Anything else is rejected with 403.
   */
  dependsOn?: string[];
};

/** Mirrors `ExtensionMetaRightSheet` from the registry (Shell-facing copy). */
export type ExtensionRightSheetMeta = {
  label?: string;
  description?: string;
  icon?: string;
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

/** Default enable map: every catalog entry starts enabled. */
export function defaultEnabledById(
  extensions: ExtensionEntry[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const ext of extensions) {
    out[ext.id] = true;
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
  extensions: ExtensionEntry[],
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
