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
  ExtensionMetaService,
  ExtensionPublicUiRoute,
  PythonServiceKind,
  RegistryModel,
  ScannedExtension,
  ScanExtensionsOptions,
  UiViewName,
} from './types';
import { DEFAULT_SERVICE_MOUNT } from './types';

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

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

function parseServiceKind(raw: unknown): PythonServiceKind | undefined {
  if (raw === 'worker' || raw === 'http') return raw;
  return undefined;
}

function normalizeMount(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw === '/') {
    return DEFAULT_SERVICE_MOUNT;
  }
  // Drop trailing slash so `/_service/` matches `/_service`
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
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
  const kind = parseServiceKind(api.kind);
  if (kind) result.kind = kind;
  const concurrency = parsePositiveInt(api.concurrency);
  if (concurrency !== undefined) result.concurrency = concurrency;
  const timeoutSeconds = parsePositiveInt(api.timeoutSeconds);
  if (timeoutSeconds !== undefined) result.timeoutSeconds = timeoutSeconds;
  return result;
}

function parseMetaService(raw: unknown): ExtensionMetaService | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const svc = raw as Record<string, unknown>;
  if (typeof svc.root !== 'string' || !svc.root) return undefined;
  const port = svc.port;
  if (typeof port !== 'number' || !Number.isFinite(port)) return undefined;

  const result: ExtensionMetaService = {
    root: svc.root,
    port,
    mount: normalizeMount(svc.mount),
  };
  if (typeof svc.health === 'string') result.health = svc.health;
  const kind = parseServiceKind(svc.kind);
  if (kind) result.kind = kind;
  const concurrency = parsePositiveInt(svc.concurrency);
  if (concurrency !== undefined) result.concurrency = concurrency;
  const timeoutSeconds = parsePositiveInt(svc.timeoutSeconds);
  if (timeoutSeconds !== undefined) result.timeoutSeconds = timeoutSeconds;
  return result;
}

function resolveServiceLink(
  rootDir: string,
  id: string,
  link: {
    root: string;
    port: number;
    health?: string;
    kind?: PythonServiceKind;
    concurrency?: number;
    timeoutSeconds?: number;
    mount?: string;
  },
): NonNullable<ScannedExtension['service']> {
  const resolvedRoot = resolve(rootDir, link.root);
  if (!isDirectory(resolvedRoot)) {
    console.warn(
      `[agentos] python service root missing for ${id}: ${resolvedRoot}`,
    );
  }
  return {
    root: link.root,
    resolvedRoot,
    port: link.port,
    ...(link.health ? { health: link.health } : {}),
    ...(link.kind ? { kind: link.kind } : {}),
    ...(link.concurrency !== undefined
      ? { concurrency: link.concurrency }
      : {}),
    ...(link.timeoutSeconds !== undefined
      ? { timeoutSeconds: link.timeoutSeconds }
      : {}),
    ...(link.mount ? { mount: link.mount } : {}),
  };
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
    const service = parseMetaService(obj.service);
    if (service) meta.service = service;
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
    if (meta.service) {
      console.warn(
        `[agentos] ${id}: meta.service ignored when api.language is python — use api.root`,
      );
    }
    extension.service = resolveServiceLink(rootDir, id, {
      root: meta.api.root,
      port: meta.api.port,
      ...(meta.api.health ? { health: meta.api.health } : {}),
      ...(meta.api.kind ? { kind: meta.api.kind } : {}),
      ...(meta.api.concurrency !== undefined
        ? { concurrency: meta.api.concurrency }
        : {}),
      ...(meta.api.timeoutSeconds !== undefined
        ? { timeoutSeconds: meta.api.timeoutSeconds }
        : {}),
    });
  } else if (meta.api?.language === 'bun' && meta.service) {
    if (meta.service.port === meta.api.port) {
      console.warn(
        `[agentos] ${id}: service.port collides with api.port (${meta.api.port})`,
      );
    }
    extension.service = resolveServiceLink(rootDir, id, meta.service);
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
