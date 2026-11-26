import type { RegistryModel } from '@agentos/core/vite/lib/types';
import type { UiContribution } from '../ui-contribs/contribution';
import {
  resolveActivityBarSection,
  type ExtensionEntry,
} from './extension-catalog';
import { requestExtensionEnableState } from './extension-enable';
import { useShellStore } from './store';

export type AppliedRegistry = {
  extensions: ExtensionEntry[];
  contributions: UiContribution[];
  skillsByExtension: Record<string, string[]>;
};

/** Map a registry model into Shell store slices (pure). */
export function mapRegistry(registry: RegistryModel): AppliedRegistry {
  const extensions: ExtensionEntry[] = registry.extensions.map((ext) => {
    const activityBarSection = resolveActivityBarSection(
      ext.meta.activityBarSection,
      ext.kind,
      ext.id,
    );
    return {
      id: ext.id,
      name: ext.name,
      kind: ext.kind,
      toggleable: ext.toggleable,
      driven: ext.driven,
      ...(ext.meta.icon ? { icon: ext.meta.icon } : {}),
      ...(activityBarSection !== 'primary' ? { activityBarSection } : {}),
      ...(ext.meta.settings?.length ? { settings: ext.meta.settings } : {}),
      ...(ext.meta.rightSheet ? { rightSheet: ext.meta.rightSheet } : {}),
    };
  });

  const contributions: UiContribution[] = [];
  const skillsByExtension: Record<string, string[]> = {};

  for (const ext of registry.extensions) {
    for (const view of [
      'page',
      'sidebar',
      'right-sidebar',
      'right-sheet',
      'widget',
      'settings',
    ] as const) {
      const src = ext.uiEntries[view];
      if (src) {
        contributions.push({
          extensionId: ext.id,
          view,
          src,
        });
      }
    }
    const skills = ext.agentDescriptors.skills;
    if (skills.length > 0) {
      skillsByExtension[ext.id] = [...skills];
    }
  }

  return { extensions, contributions, skillsByExtension };
}

/** Seed the Shell store from `virtual:agentos-registry` (or a test fixture). */
export function applyRegistry(registry: RegistryModel): AppliedRegistry {
  const applied = mapRegistry(registry);
  const store = useShellStore.getState();
  store.setExtensions(applied.extensions);
  store.setContributions(applied.contributions);
  store.setDesiredSkills(applied.skillsByExtension);
  return applied;
}

/**
 * After registry seed, pull durable enable overrides from the gateway
 * so Extension Manager matches process restarts (ticket 60).
 */
export async function hydrateEnableStateFromGateway(): Promise<void> {
  const overrides = await requestExtensionEnableState();
  if (!overrides) return;
  useShellStore.getState().hydrateEnabledById(overrides);
}
