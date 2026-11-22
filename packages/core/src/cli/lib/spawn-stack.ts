/** Shared child-process spawn for `agentos dev` and `agentos start`. */

import { BUILTIN_SERVERS, builtinApiEnv } from './builtin-servers';
import {
  discoverBunApis,
  discoverPythonServices,
  resolvePythonCmd,
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

  console.log(`[agentos] starting builtin APIs…`);
  for (const server of BUILTIN_SERVERS) {
    pm.spawn({
      name: server.name,
      cmd: ['bun', server.entry],
      cwd: packageRoot,
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
      fatalOnExit: false,
    });
  }

  const pythonServices = discoverPythonServices(extensionsDir);
  const pyEnv = builtinApiEnv(gatewayUrl);
  if (pythonServices.length === 0) {
    console.log(`[agentos] no python services under ${extensionsDir}`);
  } else {
    console.log(
      `[agentos] starting ${pythonServices.length} python service(s)…`,
    );
  }
  for (const service of pythonServices) {
    const resolved = resolvePythonCmd(service.resolvedRoot, root, pyEnv);
    if (!resolved) {
      console.warn(
        `[agentos] skip ${service.id}: no python/.venv or uv — install packages/python .venv or run uv sync in ${service.resolvedRoot}`,
      );
      continue;
    }
    const cmd = resolved.cmd.map((part) =>
      part === 'PORT' ? String(service.port) : part,
    );
    console.log(
      `[agentos] ${service.id} → http://127.0.0.1:${service.port} (proxy /api/ext/${service.id}/*)`,
    );
    pm.spawn({
      name: service.id,
      cmd,
      cwd: service.resolvedRoot,
      env: resolved.env,
      fatalOnExit: false,
    });
  }
}
