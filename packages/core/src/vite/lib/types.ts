/** Builtin vs customer extension (matches Shell / virtual:agentos-registry). */
export type ExtensionKind = 'builtin' | 'customer';

/** API language from meta.json. */
export type ApiLanguage = 'bun' | 'python';

/** Parsed `meta.json` api block. */
export type ExtensionMetaApi = {
  language: ApiLanguage;
  port: number;
  routesDir?: string;
  /** Python service root, relative to the extension directory. */
  root?: string;
  health?: string;
};

/** Activity Bar vertical region (`meta.json` `activityBarSection`). */
export type ActivityBarSection = 'primary' | 'secondary';

export type UiViewName = 'page' | 'sidebar' | 'widget';
export type AgentFileName = 'tools' | 'skills' | 'instructions';

/** One public SPA UI entry from `meta.json` `public.ui`. */
export type ExtensionPublicUiRoute = {
  /** SPA pathname (exact) or prefix ending in `/*` (e.g. `/p/demo/*`). */
  path: string;
  /** Extension view to iframe; defaults to `page`. */
  view: UiViewName;
};

/**
 * Unauthenticated portal surface from `meta.json` `public`.
 * Declaring this flips the Bun API to default-deny (session or public token).
 */
export type ExtensionMetaPublic = {
  ui?: ExtensionPublicUiRoute[];
  /** Upstream path prefixes (after `/api/ext/:id`) that accept public tokens. */
  apiPrefixes?: string[];
  /**
   * Upstream path prefixes that skip session and public-token gates
   * (OAuth callbacks / inbound webhooks — ticket 78). Pass into
   * `createApp({ openApiPrefixes })`.
   */
  openApiPrefixes?: string[];
};

/** Parsed `meta.json` (tolerant subset). */
export type ExtensionMeta = {
  name?: string;
  /**
   * Phosphor icon export basename for Shell chrome (Activity Bar, manager).
   * Example: `"Users"` → `UsersIcon`. Unknown values fall back to Cube.
   */
  icon?: string;
  /**
   * Activity Bar section. `secondary` is builtins-only; customers are coerced
   * to `primary` when the registry is applied to the Shell.
   */
  activityBarSection?: ActivityBarSection;
  api?: ExtensionMetaApi;
  /** Public (unauthenticated) UI paths and/or API prefixes. */
  public?: ExtensionMetaPublic;
};

/**
 * Tool descriptor from `agent/tools.json`.
 * Shape is extension-defined; registry keeps parsed JSON objects.
 */
export type ToolDescriptor = Record<string, unknown>;

/** Parsed agent contributions for Shell / Cmd+K / agent plane. */
export type AgentDescriptors = {
  /** Parsed entries from `tools.json` (empty when missing/invalid). */
  tools: ToolDescriptor[];
  /**
   * Skill ids from `skills.ts` (`export const skills = [...]`).
   * Filled when the virtual module statically imports the skills file.
   */
  skills: string[];
};

/** One discovered extension after a filesystem scan + enrichment. */
export type ScannedExtension = {
  id: string;
  kind: ExtensionKind;
  /**
   * Driving platform extensions (all builtins per builtins.md).
   * Agent plane rejects disable when true (ticket 14).
   */
  driven: boolean;
  /** Customer extensions only; builtins are locked. */
  toggleable: boolean;
  /** Absolute path to the extension root. */
  rootDir: string;
  /** Display name from meta.json, falling back to folder id. */
  name: string;
  /** Absolute path to meta.json when present. */
  metaPath?: string;
  meta: ExtensionMeta;
  /** Absolute paths to discovered UI entry files. */
  ui: Partial<Record<UiViewName, string>>;
  /**
   * Iframe / Shell URLs for discovered views.
   * Convention: `/__agentos/ext/<id>/<view>.html` (served by ticket 12).
   */
  uiEntries: Partial<Record<UiViewName, string>>;
  /** Absolute paths to discovered agent declaration files. */
  agent: Partial<Record<AgentFileName, string>>;
  /** Parsed tools + skills for Shell consumption. */
  agentDescriptors: AgentDescriptors;
  /** Absolute path to `api/routes` when present. */
  apiRoutesDir?: string;
  /** Resolved Python service link when `meta.api.language === 'python'`. */
  service?: {
    root: string;
    resolvedRoot: string;
    port: number;
    health?: string;
  };
};

/** In-memory registry model produced by the scanner + enrichment. */
export type RegistryModel = {
  extensions: ScannedExtension[];
  scannedAt: number;
};

/** Options for {@link scanExtensions}. */
export type ScanExtensionsOptions = {
  /** Absolute path to customer extensions root (e.g. `<viteRoot>/extensions`). */
  extensionsDir: string;
  /** Absolute path to builtin extensions root (`packages/core/builtins`). */
  builtinsDir: string;
};

/** Options for the `agentos()` Vite plugin. */
export type AgentosPluginOptions = {
  /**
   * Customer extensions directory, relative to Vite `root`.
   * @default 'extensions'
   */
  extensionsDir?: string;
  /**
   * Absolute path to builtins. Defaults to `@agentos/core` package `builtins/`.
   */
  builtinsDir?: string;
};
