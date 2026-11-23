import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { enrichExtension } from './enrich-registry';
import type {
  AgentFileName,
  ApiLanguage,
  ExtensionKind,
  ExtensionMeta,
  ExtensionMetaApi,
  ExtensionMetaPublic,
  ExtensionPublicUiRoute,
  RegistryModel,
  ScannedExtension,
  ScanExtensionsOptions,
  UiViewName,
} from './types';

/** Scan output before Shell-facing enrichment. */
type RawScannedExtension = Omit<
  ScannedExtension,
  'driven' | 'toggleable' | 'uiEntries' | 'agentDescriptors'
>;

const UI_VIEWS: UiViewName[] = ['page', 'sidebar', 'widget'];
const UI_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

const AGENT_FILES: ReadonlyArray<{ key: AgentFileName; file: string }> = [
  { key: 'tools', file: 'tools.json' },
  { key: 'skills', file: 'skills.ts' },
  { key: 'instructions', file: 'instructions.md' },
];

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listChildDirs(root: string): string[] {
  if (!isDirectory(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

function findUiFile(uiDir: string, view: UiViewName): string | undefined {
  for (const ext of UI_EXTENSIONS) {
    const candidate = join(uiDir, `${view}${ext}`);
    if (existsSync(candidate) && !isDirectory(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function parseMetaApi(raw: unknown): ExtensionMetaApi | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const api = raw as Record<string, unknown>;
  const language = api.language;
  if (language !== 'bun' && language !== 'python') return undefined;
  const port = api.port;
  if (typeof port !== 'number' || !Number.isFinite(port)) return undefined;

  const result: ExtensionMetaApi = {
    language: language as ApiLanguage,
    port,
  };
  if (typeof api.routesDir === 'string') result.routesDir = api.routesDir;
  if (typeof api.root === 'string') result.root = api.root;
  if (typeof api.health === 'string') result.health = api.health;
  if (api.kind === 'worker' || api.kind === 'http') {
    result.kind = api.kind;
  }
  if (
    typeof api.concurrency === 'number' &&
    Number.isFinite(api.concurrency) &&
    api.concurrency >= 1
  ) {
    result.concurrency = Math.floor(api.concurrency);
  }
  if (
    typeof api.timeoutSeconds === 'number' &&
    Number.isFinite(api.timeoutSeconds) &&
    api.timeoutSeconds > 0
  ) {
    result.timeoutSeconds = Math.floor(api.timeoutSeconds);
  }
  return result;
}

function parsePublicUiRoute(raw: unknown): ExtensionPublicUiRoute | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.path !== 'string' || !entry.path.startsWith('/')) {
    return undefined;
  }
  const view =
    entry.view === 'page' || entry.view === 'sidebar' || entry.view === 'widget'
      ? entry.view
      : 'page';
  return { path: entry.path, view };
}

function parseMetaPublic(raw: unknown): ExtensionMetaPublic | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const result: ExtensionMetaPublic = {};

  if (Array.isArray(obj.ui)) {
    const ui: ExtensionPublicUiRoute[] = [];
    for (const item of obj.ui) {
      const route = parsePublicUiRoute(item);
      if (route) ui.push(route);
    }
    if (ui.length > 0) result.ui = ui;
  }

  if (Array.isArray(obj.apiPrefixes)) {
    const prefixes = obj.apiPrefixes.filter(
      (p): p is string => typeof p === 'string' && p.startsWith('/'),
    );
    if (prefixes.length > 0) result.apiPrefixes = prefixes;
  }

  if (Array.isArray(obj.openApiPrefixes)) {
    const prefixes = obj.openApiPrefixes.filter(
      (p): p is string => typeof p === 'string' && p.startsWith('/'),
    );
    if (prefixes.length > 0) result.openApiPrefixes = prefixes;
  }

  if (!result.ui && !result.apiPrefixes && !result.openApiPrefixes) {
    return undefined;
  }
  return result;
}

function readMeta(metaPath: string): ExtensionMeta | undefined {
  try {
    const text = readFileSync(metaPath, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      console.warn(`[agentos] invalid meta.json (not an object): ${metaPath}`);
      return undefined;
    }
    const obj = parsed as Record<string, unknown>;
    const meta: ExtensionMeta = {};
    if (typeof obj.name === 'string') meta.name = obj.name;
    if (typeof obj.icon === 'string' && obj.icon.trim()) {
      meta.icon = obj.icon.trim();
    }
    if (
      obj.activityBarSection === 'primary' ||
      obj.activityBarSection === 'secondary'
    ) {
      meta.activityBarSection = obj.activityBarSection;
    }
    const api = parseMetaApi(obj.api);
    if (api) meta.api = api;
    const pub = parseMetaPublic(obj.public);
    if (pub) meta.public = pub;
    return meta;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[agentos] failed to read meta.json: ${metaPath} (${detail})`);
    return undefined;
  }
}

function scanOneExtension(
  id: string,
  rootDir: string,
  kind: ExtensionKind,
): RawScannedExtension {
  const metaPath = join(rootDir, 'meta.json');
  const hasMeta = existsSync(metaPath) && !isDirectory(metaPath);
  const meta = hasMeta ? (readMeta(metaPath) ?? {}) : {};

  const ui: ScannedExtension['ui'] = {};
  const uiDir = join(rootDir, 'ui');
  if (isDirectory(uiDir)) {
    for (const view of UI_VIEWS) {
      const path = findUiFile(uiDir, view);
      if (path) ui[view] = path;
    }
  }

  const agent: ScannedExtension['agent'] = {};
  const agentDir = join(rootDir, 'agent');
  if (isDirectory(agentDir)) {
    for (const { key, file } of AGENT_FILES) {
      const path = join(agentDir, file);
      if (existsSync(path) && !isDirectory(path)) {
        agent[key] = path;
      }
    }
  }

  const routesDirName = meta.api?.routesDir ?? 'api/routes';
  const apiRoutesDir = join(rootDir, routesDirName);
  const hasApiRoutes = isDirectory(apiRoutesDir);

  const extension: RawScannedExtension = {
    id,
    kind,
    rootDir,
    name: meta.name ?? id,
    meta,
    ui,
    agent,
  };

  if (hasMeta) extension.metaPath = metaPath;
  if (hasApiRoutes) extension.apiRoutesDir = apiRoutesDir;

  if (meta.api?.language === 'python' && meta.api.root) {
    const resolvedRoot = resolve(rootDir, meta.api.root);
    extension.service = {
      root: meta.api.root,
      resolvedRoot,
      port: meta.api.port,
      ...(meta.api.health ? { health: meta.api.health } : {}),
      ...(meta.api.kind ? { kind: meta.api.kind } : {}),
      ...(meta.api.concurrency !== undefined
        ? { concurrency: meta.api.concurrency }
        : {}),
      ...(meta.api.timeoutSeconds !== undefined
        ? { timeoutSeconds: meta.api.timeoutSeconds }
        : {}),
    };
    if (!isDirectory(resolvedRoot)) {
      console.warn(
        `[agentos] python service root missing for ${id}: ${resolvedRoot}`,
      );
    }
  }

  return extension;
}

function scanRoot(root: string, kind: ExtensionKind): RawScannedExtension[] {
  return listChildDirs(root).map((id) =>
    scanOneExtension(id, join(root, id), kind),
  );
}

/**
 * Discover extensions under customer `extensions/` and platform `builtins/`.
 */
export function scanExtensions(options: ScanExtensionsOptions): RegistryModel {
  const customer = scanRoot(options.extensionsDir, 'customer');
  const builtins = scanRoot(options.builtinsDir, 'builtin');

  const byId = new Map<string, RawScannedExtension>();
  // Builtins first so customer ids with the same name do not overwrite platform.
  for (const ext of builtins) byId.set(ext.id, ext);
  for (const ext of customer) {
    if (byId.has(ext.id)) {
      console.warn(
        `[agentos] customer extension id "${ext.id}" conflicts with a builtin; keeping builtin`,
      );
      continue;
    }
    byId.set(ext.id, ext);
  }

  const extensions = [...byId.values()]
    .map((ext) => enrichExtension(ext))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'builtin' ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

  return {
    extensions,
    scannedAt: Date.now(),
  };
}
