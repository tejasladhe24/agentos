import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin, ViteDevServer } from 'vite';

import {
  AGENTOS_CONFIG_FILES,
  findAgentosConfigFile,
  loadAgentosConfig,
  serializeConfigModule,
  type ResolvedAgentosConfig,
} from '@agentos/core/config';
import {
  createArmableEnableStatePersister,
  createDbStoreEnableStatePersister,
  createExtensionEnableState,
  createGateway,
  hydrateExtensionEnableStateWithRetry,
} from '@agentos/core/gateway/lib/index';

import { toConnectMiddleware, type ConnectMiddleware } from './connect-adapter';
import { serializeExtEntryModule } from './ext-entry-module';
import {
  parseVirtualExtEntryId,
  renderExtHtmlEntry,
  resolvedVirtualExtEntryId,
  virtualExtEntryId,
  virtualExtEntryScriptSrc,
} from './html-entry';
import { resolvePublicRoot } from './public-assets-middleware';
import { scanExtensions } from './scan-extensions';
import { serializeRegistryModule } from './serialize-registry';
import type {
  AgentosPluginOptions,
  RegistryModel,
  ScannedExtension,
  UiViewName,
} from './types';

export {
  createAgentControlPlaneMiddleware,
  parseAgentExtensionEnablePath,
} from './agent-control-plane';
export {
  EXT_API_PREFIX,
  createExtApiProxyMiddleware,
  parseExtApiPath,
} from './ext-api-proxy';
export type { ParsedExtApiPath, ProxyFetch } from './ext-api-proxy';
export {
  createExtensionEnableMiddleware,
  createExtensionEnableState,
  parseExtensionEnablePath,
} from './extension-enable-state';
export type { ExtensionEnableState } from './extension-enable-state';
export {
  toConnectMiddleware,
  connectToFetchRequest,
  writeFetchResponse,
} from './connect-adapter';
export type { ConnectMiddleware } from './connect-adapter';

/** Public virtual module id imported by the Shell (ticket 11). */
export const VIRTUAL_REGISTRY_ID = 'virtual:agentos-registry';

/** Resolved id with Vite's `\0` virtual prefix. */
export const RESOLVED_VIRTUAL_REGISTRY_ID = `\0${VIRTUAL_REGISTRY_ID}`;

/** Runtime config from consumer `agentos.config.ts` (ticket 43). */
export const VIRTUAL_CONFIG_ID = 'virtual:agentos-config';

/** Resolved id with Vite's `\0` virtual prefix. */
export const RESOLVED_VIRTUAL_CONFIG_ID = `\0${VIRTUAL_CONFIG_ID}`;

export {
  EXT_HTML_PREFIX,
  VIRTUAL_EXT_ENTRY_PREFIX,
  parseExtHtmlPath,
  parseVirtualExtEntryId,
  renderExtHtmlEntry,
  resolvedVirtualExtEntryId,
  virtualExtEntryId,
  virtualExtEntryScriptSrc,
} from './html-entry';

export {
  PUBLIC_ASSETS_PREFIX,
  createPublicAssetsMiddleware,
  parsePublicAssetPath,
  pathUnderRoot as publicPathUnderRoot,
  resolvePublicAssetFile,
  resolvePublicRoot,
} from './public-assets-middleware';

/** Absolute path to the `@agentos/core` package root. */
export function resolveCorePackageRoot(): string {
  // packages/core/src/vite/lib → packages/core
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

function defaultBuiltinsDir(): string {
  return join(resolveCorePackageRoot(), 'builtins');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function pathUnderRoot(file: string, root: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
  return file === root || file.startsWith(normalizedRoot);
}

function findExtension(
  model: RegistryModel,
  extensionId: string,
): ScannedExtension | undefined {
  return model.extensions.find((ext) => ext.id === extensionId);
}

function viewFilePath(
  model: RegistryModel,
  extensionId: string,
  view: UiViewName,
): string | undefined {
  return findExtension(model, extensionId)?.ui[view];
}

/**
 * Vite plugin: scan `extensions/` + `builtins/`, expose `virtual:agentos-registry`,
 * serve `/__agentos/ext/<id>/<view>.html` iframe entries, and invalidate on FS changes.
 */
export function agentos(options: AgentosPluginOptions = {}): Plugin {
  let viteRoot = process.cwd();
  let extensionsDir = '';
  let builtinsDir = '';
  let model: RegistryModel = { extensions: [], scannedAt: 0 };
  let resolvedConfig: ResolvedAgentosConfig | null = null;
  let server: ViteDevServer | undefined;
  const enableState = createExtensionEnableState();
  // Peer base so enable persistence skips the gateway proxy (ticket 60).
  if (!process.env.AGENT_OS_DB_STORE_API_BASE) {
    process.env.AGENT_OS_DB_STORE_API_BASE = 'http://127.0.0.1:6111';
  }
  const enableStatePersister = createArmableEnableStatePersister(
    createDbStoreEnableStatePersister(),
  );
  /** Rollup entry name → `{ extensionId, view }` for generateBundle HTML emit. */
  const buildEntryNames = new Map<
    string,
    { extensionId: string; view: UiViewName }
  >();

  const rescan = (): RegistryModel => {
    model = scanExtensions({ extensionsDir, builtinsDir });
    return model;
  };

  const getResolvedConfig = (): ResolvedAgentosConfig => {
    if (!resolvedConfig) {
      throw new Error('AgentOS config not loaded yet (configResolved pending)');
    }
    return resolvedConfig;
  };

  const getModel = (): RegistryModel => model;

  const getPublicRoot = (): string =>
    resolvePublicRoot(viteRoot, getResolvedConfig().publicDir);

  const mountGatewayMiddlewares = (middlewares: {
    use: (fn: ConnectMiddleware) => void;
  }): void => {
    // Single Connect bridge over portable createGateway (ticket 53).
    middlewares.use(
      toConnectMiddleware(
        createGateway({
          getModel,
          enableState,
          enableStatePersister,
          getPublicRoot,
          resolveHtmlScriptSrc: virtualExtEntryScriptSrc,
        }),
      ),
    );
  };

  const eachUiView = (
    fn: (ext: ScannedExtension, view: UiViewName, filePath: string) => void,
  ): void => {
    for (const ext of model.extensions) {
      for (const view of ['page', 'sidebar', 'widget'] as const) {
        const filePath = ext.ui[view];
        if (filePath) fn(ext, view, filePath);
      }
    }
  };

  const applyResolvedDirs = (fileConfig: ResolvedAgentosConfig): void => {
    const extensionsOption =
      options.extensionsDir ?? fileConfig.extensionsDir ?? 'extensions';
    extensionsDir = isAbsolute(extensionsOption)
      ? extensionsOption
      : resolve(viteRoot, extensionsOption);
    const builtinsOption = options.builtinsDir ?? fileConfig.builtinsDir;
    builtinsDir = builtinsOption
      ? resolve(builtinsOption)
      : defaultBuiltinsDir();
  };

  const fullReload = (): void => {
    if (!server) return;
    server.ws.send({
      type: 'full-reload',
      path: '*',
    });
  };

  const invalidateRegistry = (): void => {
    if (!server) return;
    const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_REGISTRY_ID);
    if (mod) {
      server.moduleGraph.invalidateModule(mod);
    }
    eachUiView((ext, view) => {
      const id = resolvedVirtualExtEntryId(ext.id, view);
      const entryMod = server!.moduleGraph.getModuleById(id);
      if (entryMod) {
        server!.moduleGraph.invalidateModule(entryMod);
      }
    });
    fullReload();
  };

  const invalidateConfig = (): void => {
    if (!server) return;
    const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_CONFIG_ID);
    if (mod) {
      server.moduleGraph.invalidateModule(mod);
    }
    fullReload();
  };

  const reloadAgentosConfigFromDisk = async (): Promise<void> => {
    const prevExtensionsDir = extensionsDir;
    const prevBuiltinsDir = builtinsDir;
    const fileConfig = await loadAgentosConfig(viteRoot, { bustCache: true });
    resolvedConfig = fileConfig;
    applyResolvedDirs(fileConfig);
    ensureDir(extensionsDir);
    ensureDir(builtinsDir);
    if (server) {
      if (extensionsDir !== prevExtensionsDir) {
        server.watcher.add(extensionsDir);
      }
      if (builtinsDir !== prevBuiltinsDir) {
        server.watcher.add(builtinsDir);
      }
    }
    if (
      extensionsDir !== prevExtensionsDir ||
      builtinsDir !== prevBuiltinsDir
    ) {
      rescan();
      invalidateRegistry();
      return;
    }
    invalidateConfig();
  };

  return {
    name: 'agentos',

    /**
     * Disable Vite's default `public/` → `/` mapping so branding assets are
     * only available under `/_public/` (gateway convention).
     */
    config() {
      return { publicDir: false };
    },

    async configResolved(config) {
      viteRoot = config.root;
      const fileConfig = await loadAgentosConfig(viteRoot);
      resolvedConfig = fileConfig;
      applyResolvedDirs(fileConfig);

      ensureDir(extensionsDir);
      ensureDir(builtinsDir);
      rescan();
    },

    buildStart() {
      rescan();
      buildEntryNames.clear();
      eachUiView((ext, view) => {
        const name = `__agentos/ext/${ext.id}/${view}`;
        buildEntryNames.set(name, { extensionId: ext.id, view });
      });
    },

    options(rollupOptions) {
      rescan();
      const extraInput: Record<string, string> = {};
      eachUiView((ext, view) => {
        const name = `__agentos/ext/${ext.id}/${view}`;
        extraInput[name] = virtualExtEntryId(ext.id, view);
        buildEntryNames.set(name, { extensionId: ext.id, view });
      });
      if (Object.keys(extraInput).length === 0) {
        return null;
      }
      const prev = rollupOptions.input;
      let input: Record<string, string> | string[] | string;
      if (prev == null) {
        input = extraInput;
      } else if (typeof prev === 'string') {
        input = { main: prev, ...extraInput };
      } else if (Array.isArray(prev)) {
        input = [...prev, ...Object.values(extraInput)];
      } else {
        input = { ...prev, ...extraInput };
      }
      return { ...rollupOptions, input };
    },

    resolveId(id) {
      if (id === VIRTUAL_REGISTRY_ID) {
        return RESOLVED_VIRTUAL_REGISTRY_ID;
      }
      if (id === VIRTUAL_CONFIG_ID) {
        return RESOLVED_VIRTUAL_CONFIG_ID;
      }
      const parsed = parseVirtualExtEntryId(id);
      if (parsed) {
        return resolvedVirtualExtEntryId(parsed.extensionId, parsed.view);
      }
      return undefined;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_REGISTRY_ID) {
        return serializeRegistryModule(model);
      }
      if (id === RESOLVED_VIRTUAL_CONFIG_ID) {
        return serializeConfigModule(getResolvedConfig());
      }
      const parsed = parseVirtualExtEntryId(id);
      if (!parsed) return undefined;
      const filePath = viewFilePath(model, parsed.extensionId, parsed.view);
      if (!filePath) {
        return `throw new Error(${JSON.stringify(
          `AgentOS extension view not found: ${parsed.extensionId}/${parsed.view}`,
        )});`;
      }
      return serializeExtEntryModule(filePath);
    },

    configureServer(devServer) {
      server = devServer;
      ensureDir(extensionsDir);
      ensureDir(builtinsDir);
      devServer.watcher.add(extensionsDir);
      devServer.watcher.add(builtinsDir);

      const configFile = findAgentosConfigFile(viteRoot);
      if (configFile) {
        devServer.watcher.add(configFile);
      }
      // Watch candidate names so creating agentos.config.* later is picked up.
      for (const name of AGENTOS_CONFIG_FILES) {
        devServer.watcher.add(resolve(viteRoot, name));
      }

      const configFileNames = new Set<string>(AGENTOS_CONFIG_FILES);
      const isAgentosConfigPath = (file: string): boolean => {
        const base = file.split(/[/\\]/).pop() ?? '';
        return configFileNames.has(base);
      };

      const onFsChange = (file: string): void => {
        if (isAgentosConfigPath(file)) {
          void reloadAgentosConfigFromDisk().catch((err) => {
            console.error('[agentos] failed to reload agentos.config:', err);
          });
          return;
        }
        if (
          !pathUnderRoot(file, extensionsDir) &&
          !pathUnderRoot(file, builtinsDir)
        ) {
          return;
        }
        rescan();
        invalidateRegistry();
      };

      devServer.watcher.on('add', onFsChange);
      devServer.watcher.on('unlink', onFsChange);
      devServer.watcher.on('addDir', onFsChange);
      devServer.watcher.on('unlinkDir', onFsChange);
      // meta.json / agent file edits should also refresh the model
      devServer.watcher.on('change', onFsChange);

      mountGatewayMiddlewares(devServer.middlewares);
      // Hydrate after db-store child is typically up (`agentos dev` spawns it first).
      // Arm write-through only when load succeeds (avoids 502 when db-store is down).
      void hydrateExtensionEnableStateWithRetry(
        enableState,
        enableStatePersister,
      ).then((ok) => {
        if (ok) enableStatePersister.arm();
      });
    },

    configurePreviewServer(previewServer) {
      // Post-hook: prefer `generateBundle` HTML assets from dist; fall back here.
      return () => {
        mountGatewayMiddlewares(previewServer.middlewares);
        void hydrateExtensionEnableStateWithRetry(
          enableState,
          enableStatePersister,
        ).then((ok) => {
          if (ok) enableStatePersister.arm();
        });
      };
    },

    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk' || !output.isEntry) continue;
        const meta = buildEntryNames.get(output.name);
        if (!meta) continue;
        const scriptSrc = `/${fileName}`;
        this.emitFile({
          type: 'asset',
          fileName: `__agentos/ext/${meta.extensionId}/${meta.view}.html`,
          source: renderExtHtmlEntry({
            extensionId: meta.extensionId,
            view: meta.view,
            scriptSrc,
          }),
        });
      }
    },

    /** Copy consumer `public/` → `dist/_public/` for preview / production. */
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir;
      if (!outDir) return;
      const publicRoot = getPublicRoot();
      if (!existsSync(publicRoot)) return;
      const dest = join(outDir, '_public');
      cpSync(publicRoot, dest, { recursive: true });
    },
  };
}
