import {
  defaultEnabledById,
  type ExtensionEntry,
} from '@agentos/core/shell/lib';

/** Tests only — production code must never ship fake `crm` / `invoices`. */

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
  enabledById: Record<string, boolean> = defaultEnabledById(
    STUB_EXTENSION_CATALOG,
  ),
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
