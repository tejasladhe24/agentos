import { readFileSync } from 'node:fs';

import type {
  AgentDescriptors,
  RegistryModel,
  ScannedExtension,
  ToolDescriptor,
  UiViewName,
} from './types';

const UI_VIEWS: UiViewName[] = [
  'page',
  'sidebar',
  'right-sidebar',
  'right-sheet',
  'widget',
  'settings',
];

/** Iframe entry URL convention (ticket 12 serves these). */
export function uiEntryUrl(extensionId: string, view: UiViewName): string {
  return `/__agentos/ext/${extensionId}/${view}.html`;
}

function readToolsJson(toolsPath: string | undefined): ToolDescriptor[] {
  if (!toolsPath) return [];
  try {
    const text = readFileSync(toolsPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn(`[agentos] tools.json must be an array: ${toolsPath}`);
      return [];
    }
    return parsed.filter(
      (item): item is ToolDescriptor =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(
      `[agentos] failed to read tools.json: ${toolsPath} (${detail})`,
    );
    return [];
  }
}

function buildUiEntries(
  extensionId: string,
  ui: ScannedExtension['ui'],
): Partial<Record<UiViewName, string>> {
  const entries: Partial<Record<UiViewName, string>> = {};
  for (const view of UI_VIEWS) {
    if (ui[view]) {
      entries[view] = uiEntryUrl(extensionId, view);
    }
  }
  return entries;
}

function buildAgentDescriptors(
  agent: ScannedExtension['agent'],
): AgentDescriptors {
  return {
    tools: readToolsJson(agent.tools),
    // Skills are wired via static imports in serializeRegistryModule.
    skills: [],
  };
}

/**
 * Derive Shell-facing flags, UI entry URLs, and agent tool descriptors
 * from a raw scan result.
 */
export function enrichExtension(
  extension: Omit<
    ScannedExtension,
    'driven' | 'toggleable' | 'uiEntries' | 'agentDescriptors'
  >,
): ScannedExtension {
  const driven = extension.kind === 'builtin';
  const toggleable = extension.kind === 'customer';
  return {
    ...extension,
    driven,
    toggleable,
    uiEntries: buildUiEntries(extension.id, extension.ui),
    agentDescriptors: buildAgentDescriptors(extension.agent),
  };
}

/** Enrich every extension in a registry model (idempotent). */
export function enrichRegistry(model: RegistryModel): RegistryModel {
  return {
    scannedAt: model.scannedAt,
    extensions: model.extensions.map((ext) =>
      enrichExtension({
        id: ext.id,
        kind: ext.kind,
        rootDir: ext.rootDir,
        name: ext.name,
        meta: ext.meta,
        ui: ext.ui,
        agent: ext.agent,
        ...(ext.metaPath ? { metaPath: ext.metaPath } : {}),
        ...(ext.apiRoutesDir ? { apiRoutesDir: ext.apiRoutesDir } : {}),
        ...(ext.service ? { service: ext.service } : {}),
      }),
    ),
  };
}
