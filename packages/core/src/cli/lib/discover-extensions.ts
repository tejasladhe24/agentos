import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type PythonServiceKind = 'http' | 'worker';

export type ExtensionMeta = {
  api?: {
    language?: string;
    root?: string;
    port?: number;
    kind?: string;
    concurrency?: number;
    timeoutSeconds?: number;
  };
};

export type BunApiService = {
  id: string;
  serverEntry: string;
  port: number;
};

export type PythonService = {
  id: string;
  resolvedRoot: string;
  port: number;
  /** Defaults to `http` when meta omits kind. */
  kind: PythonServiceKind;
  concurrency?: number;
  timeoutSeconds?: number;
};

/** Env keys injected for worker processes (read by `agentos.worker`). */
export const WORKER_CONCURRENCY_ENV = 'AGENT_OS_WORKER_CONCURRENCY';
export const WORKER_TIMEOUT_SECONDS_ENV = 'AGENT_OS_WORKER_TIMEOUT_SECONDS';

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readMeta(metaPath: string): ExtensionMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as ExtensionMeta;
  } catch {
    return null;
  }
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

function parseServiceKind(raw: unknown): PythonServiceKind {
  return raw === 'worker' ? 'worker' : 'http';
}

/** Discover customer Bun API servers from extensions/<id>/meta.json. */
export function discoverBunApis(extensionsDir: string): BunApiService[] {
  if (!isDirectory(extensionsDir)) return [];

  const out: BunApiService[] = [];
  for (const id of readdirSync(extensionsDir)) {
    const extDir = join(extensionsDir, id);
    if (!isDirectory(extDir)) continue;
    const metaPath = join(extDir, 'meta.json');
    if (!existsSync(metaPath)) continue;

    const meta = readMeta(metaPath);
    if (!meta) {
      console.warn(`[agentos] skip ${id}: invalid meta.json`);
      continue;
    }
    if (meta.api?.language !== 'bun') continue;
    if (typeof meta.api.port !== 'number') {
      console.warn(`[agentos] skip ${id}: bun meta missing api.port`);
      continue;
    }

    const serverEntry = join(extDir, 'api', 'server.ts');
    if (!existsSync(serverEntry)) {
      console.warn(`[agentos] skip ${id}: missing api/server.ts`);
      continue;
    }

    out.push({ id, serverEntry, port: meta.api.port });
  }
  return out;
}

/** Discover customer Python services from extensions/<id>/meta.json. */
export function discoverPythonServices(extensionsDir: string): PythonService[] {
  if (!isDirectory(extensionsDir)) return [];

  const out: PythonService[] = [];
  for (const id of readdirSync(extensionsDir)) {
    const extDir = join(extensionsDir, id);
    if (!isDirectory(extDir)) continue;
    const metaPath = join(extDir, 'meta.json');
    if (!existsSync(metaPath)) continue;

    const meta = readMeta(metaPath);
    if (!meta) {
      console.warn(`[agentos] skip ${id}: invalid meta.json`);
      continue;
    }
    if (meta.api?.language !== 'python') continue;
    if (typeof meta.api.root !== 'string' || !meta.api.root) {
      console.warn(`[agentos] skip ${id}: python meta missing api.root`);
      continue;
    }
    if (typeof meta.api.port !== 'number') {
      console.warn(`[agentos] skip ${id}: python meta missing api.port`);
      continue;
    }

    const resolvedRoot = resolve(extDir, meta.api.root);
    if (!isDirectory(resolvedRoot)) {
      console.warn(
        `[agentos] skip ${id}: python service root missing: ${resolvedRoot}`,
      );
      continue;
    }

    const kind = parseServiceKind(meta.api.kind);
    const concurrency = parsePositiveInt(meta.api.concurrency);
    const timeoutSeconds = parsePositiveInt(meta.api.timeoutSeconds);

    if (
      meta.api.kind != null &&
      meta.api.kind !== 'http' &&
      meta.api.kind !== 'worker'
    ) {
      console.warn(
        `[agentos] ${id}: unknown api.kind "${String(meta.api.kind)}" — treating as http`,
      );
    }

    out.push({
      id,
      resolvedRoot,
      port: meta.api.port,
      kind,
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    });
  }
  return out;
}

/**
 * Env vars for a worker process (concurrency + timeout).
 * HTTP services get an empty object.
 */
export function workerProcessEnv(
  service: Pick<PythonService, 'kind' | 'concurrency' | 'timeoutSeconds'>,
): Record<string, string> {
  if (service.kind !== 'worker') return {};
  const env: Record<string, string> = {};
  if (service.concurrency !== undefined) {
    env[WORKER_CONCURRENCY_ENV] = String(service.concurrency);
  }
  if (service.timeoutSeconds !== undefined) {
    env[WORKER_TIMEOUT_SECONDS_ENV] = String(service.timeoutSeconds);
  }
  return env;
}

function pythonHasUvicorn(pythonBin: string): boolean {
  const result = Bun.spawnSync([pythonBin, '-c', 'import uvicorn'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return result.exitCode === 0;
}

export type ResolvedPythonCmd = {
  cmd: string[];
  env: Record<string, string>;
};

/**
 * Resolve uvicorn launch command for a Python service.
 * Prefers service/.venv or packages/python/.venv; falls back to `uv run`.
 */
export function resolvePythonCmd(
  serviceRoot: string,
  repoRoot: string,
  baseEnv: Record<string, string>,
): ResolvedPythonCmd | null {
  const agentosPython = join(repoRoot, 'packages/python');
  const serviceVenvPython = join(serviceRoot, '.venv/bin/python');
  const kitVenvPython = join(agentosPython, '.venv/bin/python');
  const pythonPathEnv = {
    ...baseEnv,
    PYTHONPATH: [agentosPython, serviceRoot, Bun.env.PYTHONPATH]
      .filter(Boolean)
      .join(':'),
  };

  const candidates = [serviceVenvPython, kitVenvPython].filter(
    (bin) => existsSync(bin) && pythonHasUvicorn(bin),
  );

  if (candidates.length > 0) {
    return {
      cmd: [
        candidates[0]!,
        '-m',
        'uvicorn',
        'app.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        'PORT',
      ],
      env: pythonPathEnv,
    };
  }

  const uv = Bun.which('uv');
  if (uv) {
    return {
      cmd: [
        uv,
        'run',
        'uvicorn',
        'app.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        'PORT',
      ],
      env: baseEnv,
    };
  }

  return null;
}
