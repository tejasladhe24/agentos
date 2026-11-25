/** Shared child-process spawn for `agentos dev` and `agentos start`. */

import { BUILTIN_SERVERS, builtinApiEnv } from './builtin-servers';
import {
  discoverBunApis,
  discoverPythonServices,
  pythonProcessName,
  resolvePythonCmd,
  workerProcessEnv,
} from './discover-extensions';
import { corePackageRoot, repoRoot } from './paths';
import type { ProcessManager } from './process-manager';

export type SpawnStackOptions = {
  consumerRoot: string;
  extensionsDir: string;
  /** Passed to {@link builtinApiEnv} and used for Python children. */
  gatewayUrl?: string;
  pm: ProcessManager;
};

/**
 * Spawn builtins (fatal), customer Bun APIs, and Python services.
 * Does not start Vite — callers add that for `dev` only.
 */
export function spawnAgentOsStack(options: SpawnStackOptions): void {
  const { consumerRoot, extensionsDir, pm } = options;
  const packageRoot = corePackageRoot();
  const root = repoRoot();
  const gatewayUrl = options.gatewayUrl;
  // Vite may bind only `[::1]`, so the `127.0.0.1` gateway fallback can refuse connections.
  const apiEnv = builtinApiEnv(gatewayUrl);

  console.log(`[agentos] starting builtin APIs…`);
  for (const server of BUILTIN_SERVERS) {
    pm.spawn({
      name: server.name,
      cmd: ['bun', server.entry],
      cwd: packageRoot,
      env: apiEnv,
      fatalOnExit: true,
    });
  }

  const bunApis = discoverBunApis(extensionsDir);
  if (bunApis.length === 0) {
    console.log(`[agentos] no customer Bun APIs under ${extensionsDir}`);
  } else {
    console.log(`[agentos] starting ${bunApis.length} customer Bun API(s)…`);
  }
  for (const api of bunApis) {
    console.log(
      `[agentos] ${api.id} → http://127.0.0.1:${api.port} (proxy /api/ext/${api.id}/*)`,
    );
    pm.spawn({
      name: api.id,
      cmd: ['bun', api.serverEntry],
      cwd: consumerRoot,
      env: apiEnv,
      fatalOnExit: false,
    });
  }

  const pythonServices = discoverPythonServices(extensionsDir);
  const pyEnv = apiEnv;
  const httpServices = pythonServices.filter((s) => s.kind === 'http');
  const workerServices = pythonServices.filter((s) => s.kind === 'worker');

  if (pythonServices.length === 0) {
    console.log(`[agentos] no python services under ${extensionsDir}`);
  } else {
    if (httpServices.length > 0) {
      console.log(
        `[agentos] starting ${httpServices.length} python HTTP service(s)…`,
      );
    }
    if (workerServices.length > 0) {
      console.log(
        `[agentos] starting ${workerServices.length} python worker(s)…`,
      );
    }
  }

  for (const service of pythonServices) {
    const procName = pythonProcessName(service);
    const resolved = resolvePythonCmd(service.resolvedRoot, root, {
      ...pyEnv,
      ...workerProcessEnv(service),
    });
    if (!resolved) {
      console.warn(
        `[agentos] skip ${procName}: no python/.venv or uv — install packages/python .venv or run uv sync in ${service.resolvedRoot}`,
      );
      continue;
    }
    const cmd = resolved.cmd.map((part) =>
      part === 'PORT' ? String(service.port) : part,
    );
    const mount = service.mount ?? '/_service';
    const proxyNote = service.dual
      ? `proxy /api/ext/${service.id}${mount}/*`
      : `proxy /api/ext/${service.id}/*`;
    if (service.kind === 'worker') {
      const caps: string[] = [];
      if (service.concurrency !== undefined) {
        caps.push(`concurrency=${service.concurrency}`);
      }
      if (service.timeoutSeconds !== undefined) {
        caps.push(`timeout=${service.timeoutSeconds}s`);
      }
      const capNote = caps.length > 0 ? ` (${caps.join(', ')})` : '';
      console.log(
        `[agentos] worker ${procName} → http://127.0.0.1:${service.port} (health/triggers; ${proxyNote})${capNote}`,
      );
    } else {
      console.log(
        `[agentos] ${procName} → http://127.0.0.1:${service.port} (${proxyNote})`,
      );
    }
    pm.spawn({
      name: procName,
      cmd,
      cwd: service.resolvedRoot,
      env: resolved.env,
      fatalOnExit: false,
    });
  }
}
