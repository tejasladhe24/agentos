/**
 * Production entrypoint: child APIs/services + Bun.serve gateway + static dist/.
 *
 * GET /healthz reports that this Bun.serve gateway is up. It does not probe
 * child processes; fatal builtin exits kill the process via ProcessManager.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  createArmableEnableStatePersister,
  createDbStoreEnableStatePersister,
  createExtensionEnableState,
  createGateway,
  hydrateExtensionEnableStateWithRetry,
  requestPathname,
} from '@agentos/core/gateway';
import { scanExtensions } from '@agentos/core/vite';

import { corePackageRoot } from './paths';
import { ProcessManager } from './process-manager';
import { resolveConsumerRoot, resolveExtensionsDir } from './resolve-consumer';
import { spawnAgentOsStack } from './spawn-stack';
import { tryServeStatic, trySpaFallback } from './static-server';

export type StartOptions = {
  /** Consumer app root override (`--cwd`). */
  cwd?: string;
  /** Prefix child logs. Default true. */
  prefixLogs?: boolean;
  /**
   * Override listen port (tests). Default: `PORT` env or 8080.
   */
  port?: number;
  /**
   * When false, skip spawning children (unit tests for the HTTP pipeline).
   * Default true.
   */
  spawnChildren?: boolean;
  /**
   * When false, return after the server is listening instead of waiting for
   * shutdown (unit tests). Default true.
   */
  waitForShutdown?: boolean;
};

export type StartHandle = {
  port: number;
  stop: () => void;
};

const DEFAULT_PORT = 8080;

export function resolveStartPort(portOption?: number): number {
  // Explicit 0 = ephemeral port (tests / Bun.serve).
  if (portOption != null && Number.isFinite(portOption) && portOption >= 0) {
    return Math.floor(portOption);
  }
  const fromEnv = Number(Bun.env.PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_PORT;
}

export function productionGatewayUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function requireDistDir(consumerRoot: string): string {
  const distRoot = join(consumerRoot, 'dist');
  if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
    throw new Error(
      `agentos start: missing dist/ under ${consumerRoot}\n` +
        `Run \`agentos build\` first, then \`agentos start\`.`,
    );
  }
  return distRoot;
}

/**
 * Build the production fetch handler (gateway → static → SPA).
 * Exported for unit tests.
 */
export function createStartFetchHandler(options: {
  distRoot: string;
  gateway: (request: Request) => Response | null | Promise<Response | null>;
}): (request: Request) => Promise<Response> {
  const { distRoot, gateway } = options;

  return async (request) => {
    const pathname = requestPathname(request);
    const method = request.method;

    if (
      (method === 'GET' || method === 'HEAD') &&
      (pathname === '/healthz' || pathname === '/healthz/')
    ) {
      const body = JSON.stringify({ ok: true });
      const headers = { 'Content-Type': 'application/json; charset=utf-8' };
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      return new Response(body, { status: 200, headers });
    }

    const gw = await gateway(request);
    if (gw != null) return gw;

    const staticRes = tryServeStatic(distRoot, pathname, method);
    if (staticRes != null) return await staticRes;

    const spa = trySpaFallback(distRoot, pathname, method);
    if (spa != null) return await spa;

    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  };
}

/**
 * Start the production AgentOS stack and serve `dist/` + gateway on PORT.
 */
export async function runStart(
  options: StartOptions = {},
): Promise<StartHandle | void> {
  const consumerRoot = resolveConsumerRoot(options.cwd);
  const extensionsDir = resolveExtensionsDir(consumerRoot);
  const distRoot = requireDistDir(consumerRoot);
  const listenPort = resolveStartPort(options.port);
  const spawnChildren = options.spawnChildren !== false;
  const waitForShutdown = options.waitForShutdown !== false;

  const builtinsDir = join(corePackageRoot(), 'builtins');
  const model = scanExtensions({ extensionsDir, builtinsDir });
  const getModel = () => model;
  const enableState = createExtensionEnableState();
  const enableStatePersister = createArmableEnableStatePersister(
    createDbStoreEnableStatePersister(),
  );
  const publicRoot = join(distRoot, '_public');

  const gateway = createGateway({
    getModel,
    enableState,
    enableStatePersister,
    getPublicRoot: () => publicRoot,
    resolveHtmlScriptSrc: () => '',
    serveExtHtml: false,
  });

  const fetchHandler = createStartFetchHandler({ distRoot, gateway });

  const pm = new ProcessManager({ prefixLogs: options.prefixLogs });
  pm.installSignalHandlers();

  console.log(`[agentos] consumer: ${consumerRoot}`);
  console.log(`[agentos] dist: ${distRoot}`);

  const server = Bun.serve({
    port: listenPort,
    fetch: fetchHandler,
  });

  const boundPort = server.port;
  if (boundPort == null) {
    server.stop(true);
    throw new Error('agentos start: Bun.serve did not bind a port');
  }

  const gatewayUrl = productionGatewayUrl(boundPort);
  Bun.env.AGENT_OS_GLOBAL_GATEWAY_URL = gatewayUrl;
  console.log(`[agentos] AGENT_OS_GLOBAL_GATEWAY_URL=${gatewayUrl}`);
  console.log(`[agentos] listening on http://127.0.0.1:${boundPort}`);
  console.log(
    `[agentos] GET /healthz → gateway up (child processes not probed; ` +
      `fatal builtin exit shuts down via ProcessManager)`,
  );

  if (spawnChildren) {
    spawnAgentOsStack({
      consumerRoot,
      extensionsDir,
      gatewayUrl,
      pm,
    });
    const hydrated = await hydrateExtensionEnableStateWithRetry(
      enableState,
      enableStatePersister,
    );
    if (hydrated) {
      enableStatePersister.arm();
    }
  }

  const handle: StartHandle = {
    port: boundPort,
    stop: () => {
      server.stop(true);
      pm.shutdown('stop');
    },
  };

  if (!waitForShutdown) {
    return handle;
  }

  await pm.waitForShutdown();
  server.stop(true);
  process.exit(0);
}
